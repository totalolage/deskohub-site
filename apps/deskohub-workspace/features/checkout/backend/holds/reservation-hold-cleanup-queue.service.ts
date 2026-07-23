import { DuplicateMessageError, send } from "@vercel/queue";
import { Context, Data, Duration, Effect, Layer, Option, Schema } from "effect";
import type { WorkspaceReservation } from "@/db/schema";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { clamp } from "@/shared/utils";
import { serializeErrorForLog } from "@/shared/utils/error-formatting";
import { instantStringSchema } from "@/shared/utils/temporal";
import {
  type ReservationHoldCleanupOutcome,
  ReservationHoldCleanupService,
} from "./reservation-hold-cleanup.service";

export const reservationHoldCleanupQueueTopic =
  "workspace-reservation-hold-cleanup";

export const reservationHoldCleanupScheduleMaxDelaySeconds = 7 * 24 * 60 * 60;
const reservationHoldCleanupRetryWindowSeconds = 60 * 60;
const attachmentCancellationRetentionSeconds = 7 * 24 * 60 * 60;

const LegacyReservationHoldCleanupSchedulePayloadSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  orderId: Schema.String,
  reservationHoldExpiresAtIso: instantStringSchema,
});

const ReservationHoldCleanupSchedulePayloadSchema = Schema.Union([
  LegacyReservationHoldCleanupSchedulePayloadSchema,
  Schema.Struct({
    schemaVersion: Schema.Literal(2),
    reason: Schema.Literal("hold_expired"),
    orderId: Schema.String,
    reservationHoldExpiresAtIso: instantStringSchema,
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(2),
    reason: Schema.Literal("attachment_compensation"),
    orderId: Schema.String,
    dotyposReservationId: Schema.String,
    reservationCreatedAtIso: instantStringSchema,
  }),
]);

export type ReservationHoldCleanupSchedulePayload =
  typeof ReservationHoldCleanupSchedulePayloadSchema.Encoded;

type ReservationCancellationScheduleInput =
  | {
      readonly reason: "hold_expired";
      readonly orderId: string;
      readonly reservationHoldExpiresAt: Temporal.Instant;
    }
  | {
      readonly reason: "attachment_compensation";
      readonly orderId: string;
      readonly dotyposReservationId: string;
      readonly reservationCreatedAt: Temporal.Instant;
    };

type ReservationHoldCleanupScheduleMessage = {
  readonly topic: typeof reservationHoldCleanupQueueTopic;
  readonly payload: ReservationHoldCleanupSchedulePayload;
  readonly options: {
    readonly delaySeconds: number;
    readonly retentionSeconds: number;
    readonly idempotencyKey: string;
  };
};

type ReservationHoldCleanupEnqueueResult = "duplicate" | "enqueued";

export class ReservationHoldCleanupScheduleError extends Data.TaggedError(
  "ReservationHoldCleanupScheduleError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  static fromError(message: string) {
    return (cause: unknown) =>
      new ReservationHoldCleanupScheduleError({
        message,
        cause: serializeErrorForLog(cause),
      });
  }
}

export class AttachmentCancellationHandoffError extends Data.TaggedError(
  "AttachmentCancellationHandoffError"
)<{
  readonly message: string;
}> {}

class ReservationHoldCleanupQueueDuplicateError extends Data.TaggedError(
  "ReservationHoldCleanupQueueDuplicateError"
) {}

class ReservationHoldCleanupQueueRequestError extends Data.TaggedError(
  "ReservationHoldCleanupQueueRequestError"
)<{
  readonly cause: unknown;
}> {}

interface IReservationHoldCleanupScheduleService {
  readonly enqueueCleanup: (
    input: ReservationCancellationScheduleInput
  ) => Effect.Effect<void, ReservationHoldCleanupScheduleError>;
}

export const getReservationHoldCleanupScheduleMessage = (
  input: {
    readonly orderId: string;
    readonly reservationHoldExpiresAt: Temporal.Instant;
  },
  now = Temporal.Now.instant()
): ReservationHoldCleanupScheduleMessage => {
  const reservationHoldExpiresAtIso = input.reservationHoldExpiresAt.toString();
  const delaySeconds = clamp(
    Math.ceil(
      (input.reservationHoldExpiresAt.epochMilliseconds -
        now.epochMilliseconds) /
        1000
    ),
    0,
    reservationHoldCleanupScheduleMaxDelaySeconds
  );
  const retentionSeconds = clamp(
    delaySeconds + reservationHoldCleanupRetryWindowSeconds,
    60,
    reservationHoldCleanupScheduleMaxDelaySeconds
  );

  return {
    topic: reservationHoldCleanupQueueTopic,
    payload: {
      schemaVersion: 2,
      reason: "hold_expired",
      orderId: input.orderId,
      reservationHoldExpiresAtIso,
    } satisfies ReservationHoldCleanupSchedulePayload,
    options: {
      delaySeconds,
      retentionSeconds,
      idempotencyKey: `reservation-hold-cleanup:${input.orderId}:${reservationHoldExpiresAtIso}`,
    },
  };
};

export const getAttachmentCancellationScheduleMessage = (input: {
  readonly orderId: string;
  readonly dotyposReservationId: string;
  readonly reservationCreatedAt: Temporal.Instant;
}): ReservationHoldCleanupScheduleMessage => ({
  topic: reservationHoldCleanupQueueTopic,
  payload: {
    schemaVersion: 2,
    reason: "attachment_compensation",
    orderId: input.orderId,
    dotyposReservationId: input.dotyposReservationId,
    reservationCreatedAtIso: input.reservationCreatedAt.toString(),
  },
  options: {
    delaySeconds: 0,
    retentionSeconds: attachmentCancellationRetentionSeconds,
    idempotencyKey: `reservation-attachment-cancellation:${input.orderId}:${input.dotyposReservationId}`,
  },
});

export function makeReservationHoldCleanupScheduleService(
  sendMessage: typeof send = send
): IReservationHoldCleanupScheduleService {
  return {
    enqueueCleanup: Effect.fn("reservationHoldCleanupSchedule.enqueueCleanup")(
      function* (input) {
        const message =
          input.reason === "hold_expired"
            ? getReservationHoldCleanupScheduleMessage(input)
            : getAttachmentCancellationScheduleMessage(input);
        yield* Effect.logInfo("Reservation hold cleanup enqueue started", {
          message,
        });

        const result = yield* Effect.tryPromise({
          try: async () => {
            await sendMessage(message.topic, message.payload, message.options);
            return "enqueued" as const;
          },
          catch: (cause) =>
            cause instanceof DuplicateMessageError
              ? new ReservationHoldCleanupQueueDuplicateError()
              : new ReservationHoldCleanupQueueRequestError({ cause }),
        }).pipe(
          Effect.catchTag("ReservationHoldCleanupQueueDuplicateError", () =>
            Effect.succeed("duplicate" as const)
          ),
          Effect.mapError((error) =>
            ReservationHoldCleanupScheduleError.fromError(
              "Reservation hold cleanup could not be enqueued."
            )(error.cause)
          )
        );

        const enqueueResultMessages = {
          duplicate: "Reservation hold cleanup was already enqueued",
          enqueued: "Reservation hold cleanup enqueued",
        } satisfies Record<ReservationHoldCleanupEnqueueResult, string>;

        yield* Effect.logInfo(enqueueResultMessages[result], { message });
      }
    ),
  };
}

export class ReservationHoldCleanupScheduleService extends Context.Service<
  ReservationHoldCleanupScheduleService,
  IReservationHoldCleanupScheduleService
>()("ReservationHoldCleanupScheduleService") {
  static Live = Layer.succeed(
    this,
    makeReservationHoldCleanupScheduleService()
  );
}

export const enqueueReservationHoldCleanup = Effect.fn(
  "reservationHoldCleanupSchedule.enqueueBestEffort"
)(function* (input: {
  readonly orderId: string;
  readonly reservationHoldExpiresAt: Temporal.Instant | null;
}) {
  if (!input.reservationHoldExpiresAt) {
    yield* Effect.logWarning(
      "Workspace reservation hold cleanup enqueue skipped: missing hold expiry",
      { orderId: input.orderId }
    );
    return;
  }

  const cleanupSchedule = yield* ReservationHoldCleanupScheduleService;
  const enqueue = cleanupSchedule
    .enqueueCleanup({
      reason: "hold_expired",
      orderId: input.orderId,
      reservationHoldExpiresAt: input.reservationHoldExpiresAt,
    })
    .pipe(
      Effect.tapError((cause) =>
        Effect.logError("Workspace reservation hold cleanup enqueue failed", {
          orderId: input.orderId,
          cause,
        })
      )
    );

  yield* enqueue.pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(2),
      orElse: () =>
        Effect.logWarning(
          "Workspace reservation hold cleanup enqueue timed out",
          {
            orderId: input.orderId,
          }
        ),
    }),
    Effect.ignore
  );
});

export const enqueueAttachmentCancellationCompensation = Effect.fn(
  "reservationHoldCleanupSchedule.enqueueAttachmentCancellationCompensation"
)(function* (input: {
  readonly orderId: string;
  readonly dotyposReservationId: string;
  readonly reservationCreatedAt: Temporal.Instant;
}) {
  const reservations = yield* WorkspaceReservationRepository;
  const cleanupSchedule = yield* ReservationHoldCleanupScheduleService;
  const [marker, enqueue] = yield* Effect.all(
    [
      reservations
        .recordAttachmentCancellationHandoff({
          id: input.orderId,
          dotyposReservationId: input.dotyposReservationId,
          reservationCreatedAt: input.reservationCreatedAt,
          failureCode: "attach_failed_cancellation_required",
        })
        .pipe(Effect.result),
      cleanupSchedule
        .enqueueCleanup({
          reason: "attachment_compensation",
          orderId: input.orderId,
          dotyposReservationId: input.dotyposReservationId,
          reservationCreatedAt: input.reservationCreatedAt,
        })
        .pipe(Effect.result),
    ],
    { concurrency: "inherit" }
  );

  if (marker._tag === "Failure") {
    yield* Effect.logError(
      "Workspace reservation attachment compensation marker failed",
      { orderId: input.orderId, cause: marker.failure }
    );
  }
  if (enqueue._tag === "Failure") {
    yield* Effect.logError(
      "Workspace reservation attachment compensation enqueue failed",
      { orderId: input.orderId, cause: enqueue.failure }
    );
  }

  const markerPersisted = marker._tag === "Success" && marker.success !== null;
  if (!(markerPersisted || enqueue._tag === "Success")) {
    return yield* new AttachmentCancellationHandoffError({
      message:
        "Reservation attachment cancellation identity could not be handed off.",
    });
  }
});

const decodeSchedulePayload = Schema.decodeUnknownOption(
  ReservationHoldCleanupSchedulePayloadSchema
);

const dueReservationStates = ["held", "cancelling", "cancellation_failed"];

const isDueReservation = (
  reservation: WorkspaceReservation | null,
  reservationHoldExpiresAt: Temporal.Instant,
  now: Temporal.Instant
) =>
  reservation !== null &&
  dueReservationStates.includes(reservation?.reservationState ?? "") &&
  reservation.paymentState !== "paid" &&
  reservation.reservationHoldExpiresAt?.equals(reservationHoldExpiresAt) &&
  Temporal.Instant.compare(reservation.reservationHoldExpiresAt, now) <= 0;

export const processReservationHoldCleanupScheduleMessage = Effect.fn(
  "reservationHoldCleanupSchedule.processMessage"
)(function* (message: unknown, now = Temporal.Now.instant()) {
  const payload = Option.getOrUndefined(decodeSchedulePayload(message));
  if (!payload) {
    yield* Effect.logWarning(
      "Reservation hold cleanup queue message ignored: invalid payload"
    );
    return "ignored" as const;
  }

  const reservations = yield* WorkspaceReservationRepository;
  const cleanup = yield* ReservationHoldCleanupService;

  if (
    payload.schemaVersion === 2 &&
    payload.reason === "attachment_compensation"
  ) {
    const handoff = yield* reservations
      .recordAttachmentCancellationHandoff({
        id: payload.orderId,
        dotyposReservationId: payload.dotyposReservationId,
        reservationCreatedAt: Temporal.Instant.from(
          payload.reservationCreatedAtIso
        ),
        failureCode: "attach_failed_cancellation_required",
      })
      .pipe(
        Effect.mapError(
          ReservationHoldCleanupScheduleError.fromError(
            "Queued attachment cancellation identity could not be recorded."
          )
        )
      );
    if (!handoff) {
      yield* Effect.logInfo(
        "Attachment cancellation queue message ignored: reservation state changed",
        { orderId: payload.orderId }
      );
      return "ignored" as const;
    }
    return yield* cleanup
      .cancelOrderHold({
        orderId: payload.orderId,
        recoveryReason: "attachment_compensation",
      })
      .pipe(
        Effect.mapError(
          ReservationHoldCleanupScheduleError.fromError(
            "Queued attachment cancellation failed."
          )
        )
      );
  }

  const reservationHoldExpiresAt = Temporal.Instant.from(
    payload.reservationHoldExpiresAtIso
  );
  const reservation = yield* reservations
    .findById(payload.orderId)
    .pipe(
      Effect.mapError(
        ReservationHoldCleanupScheduleError.fromError(
          "Queued reservation hold cleanup state could not be loaded."
        )
      )
    );

  if (!isDueReservation(reservation, reservationHoldExpiresAt, now)) {
    yield* Effect.logInfo(
      "Reservation hold cleanup queue message ignored: reservation not due",
      { payload }
    );
    return "ignored" as const;
  }

  const outcome = yield* cleanup
    .cancelOrderHold({
      orderId: payload.orderId,
      recoveryReason: "hold_expired",
      holdExpiredAt: now,
    })
    .pipe(
      Effect.mapError(
        ReservationHoldCleanupScheduleError.fromError(
          "Queued reservation hold cleanup failed."
        )
      )
    );

  return outcome satisfies ReservationHoldCleanupOutcome;
});
