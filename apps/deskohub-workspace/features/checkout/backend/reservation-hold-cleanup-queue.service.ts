import { DuplicateMessageError, send } from "@vercel/queue";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import type { WorkspaceReservation } from "@/db/schema";
import {
  type ReservationHoldCleanupOutcome,
  ReservationHoldCleanupService,
} from "@/features/checkout/backend/reservation-hold-cleanup.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { clamp } from "@/shared/utils";

export const reservationHoldCleanupQueueTopic =
  "workspace-reservation-hold-cleanup";

export const reservationHoldCleanupScheduleMaxDelaySeconds = 7 * 24 * 60 * 60;
const reservationHoldCleanupRetryWindowSeconds = 60 * 60;

const ReservationHoldCleanupSchedulePayloadSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  orderId: Schema.String,
  reservationHoldExpiresAtIso: Schema.String,
});

export type ReservationHoldCleanupSchedulePayload = Schema.Schema.Type<
  typeof ReservationHoldCleanupSchedulePayloadSchema
>;

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
      new ReservationHoldCleanupScheduleError({ message, cause });
  }
}

interface IReservationHoldCleanupScheduleService {
  readonly enqueueCleanup: (input: {
    readonly orderId: string;
    readonly reservationHoldExpiresAt: Date;
  }) => Effect.Effect<void, ReservationHoldCleanupScheduleError>;
}

export const getReservationHoldCleanupScheduleMessage = (
  input: {
    readonly orderId: string;
    readonly reservationHoldExpiresAt: Date;
  },
  now = new Date()
): ReservationHoldCleanupScheduleMessage => {
  const reservationHoldExpiresAtIso =
    input.reservationHoldExpiresAt.toISOString();
  const delaySeconds = clamp(
    Math.ceil(
      (input.reservationHoldExpiresAt.getTime() - now.getTime()) / 1000
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
      schemaVersion: 1,
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

export class ReservationHoldCleanupScheduleService extends Context.Service<
  ReservationHoldCleanupScheduleService,
  IReservationHoldCleanupScheduleService
>()("ReservationHoldCleanupScheduleService") {
  static Live = Layer.succeed(this, {
    enqueueCleanup: Effect.fn("reservationHoldCleanupSchedule.enqueueCleanup")(
      function* (input) {
        const message = getReservationHoldCleanupScheduleMessage(input);
        yield* Effect.logInfo("Reservation hold cleanup enqueue started", {
          message,
        });

        const result = yield* Effect.tryPromise({
          try: async () => {
            await send(message.topic, message.payload, message.options);
            return "enqueued" as const;
          },
          catch: (cause) => cause,
        }).pipe(
          Effect.catchIf(
            (cause) => cause instanceof DuplicateMessageError,
            () => Effect.succeed("duplicate" as const)
          ),
          Effect.mapError(
            ReservationHoldCleanupScheduleError.fromError(
              "Reservation hold cleanup could not be enqueued."
            )
          )
        );

        const enqueueResultMessages = {
          duplicate: "Reservation hold cleanup was already enqueued",
          enqueued: "Reservation hold cleanup enqueued",
        } satisfies Record<ReservationHoldCleanupEnqueueResult, string>;

        yield* Effect.logInfo(enqueueResultMessages[result], { message });
      }
    ),
  });
}

const decodeSchedulePayload = Schema.decodeUnknownOption(
  ReservationHoldCleanupSchedulePayloadSchema
);

const dueReservationStates = ["held", "cancelling", "cancellation_failed"];

const isDueReservation = (
  reservation: WorkspaceReservation | null,
  reservationHoldExpiresAt: Date,
  now: Date
) =>
  reservation !== null &&
  dueReservationStates.includes(reservation?.reservationState ?? "") &&
  reservation.paymentState !== "paid" &&
  reservation.reservationHoldExpiresAt?.getTime() ===
    reservationHoldExpiresAt.getTime() &&
  reservation.reservationHoldExpiresAt <= now;

export const processReservationHoldCleanupScheduleMessage = Effect.fn(
  "reservationHoldCleanupSchedule.processMessage"
)(function* (message: unknown, now = new Date()) {
  const payload = Option.getOrUndefined(decodeSchedulePayload(message));
  if (!payload) {
    yield* Effect.logWarning(
      "Reservation hold cleanup queue message ignored: invalid payload"
    );
    return "ignored" as const;
  }

  const reservationHoldExpiresAt = new Date(
    payload.reservationHoldExpiresAtIso
  );

  const reservations = yield* WorkspaceReservationRepository;
  const cleanup = yield* ReservationHoldCleanupService;
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
    .cancelOrderHold({ orderId: payload.orderId, holdExpiredAt: now })
    .pipe(
      Effect.mapError(
        ReservationHoldCleanupScheduleError.fromError(
          "Queued reservation hold cleanup failed."
        )
      )
    );

  if (outcome === "skipped") {
    const current = yield* reservations
      .findById(payload.orderId)
      .pipe(
        Effect.mapError(
          ReservationHoldCleanupScheduleError.fromError(
            "Queued reservation hold cleanup state could not be reloaded."
          )
        )
      );

    if (isDueReservation(current, reservationHoldExpiresAt, now)) {
      return yield* new ReservationHoldCleanupScheduleError({
        message: "Queued reservation hold cleanup skipped while still due.",
      });
    }
  }

  return outcome satisfies ReservationHoldCleanupOutcome;
});
