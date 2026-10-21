import { DuplicateMessageError, send } from "@vercel/queue";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { toStoredInstant } from "@/db/instant";
import type { WorkspaceReservation } from "@/db/schema";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { QueueRedelivery } from "@/shared/backend/queue/queue-consumer";
import { clamp } from "@/shared/utils";
import { instantStringSchema } from "@/shared/utils/temporal";
import { ProviderPaymentDeferral } from "../payment/provider-payment-finalization.service";
import {
  type ReservationHoldCleanupOutcome,
  ReservationHoldCleanupService,
} from "./reservation-hold-cleanup.service";

export const reservationHoldCleanupQueueTopic =
  "workspace-reservation-hold-cleanup";

export const reservationHoldCleanupScheduleMaxDelaySeconds = 7 * 24 * 60 * 60;
const reservationHoldCleanupRetryWindowSeconds = 60 * 60;

const reservationHoldCleanupIdempotencyKeySchema = Schema.NonEmptyString.pipe(
  Schema.brand("ReservationHoldCleanupIdempotencyKey")
).annotate({
  identifier: "ReservationHoldCleanupIdempotencyKey",
  description: "Idempotency key for scheduling one reservation-hold cleanup.",
});
type ReservationHoldCleanupIdempotencyKey =
  typeof reservationHoldCleanupIdempotencyKeySchema.Type;

const makeReservationHoldCleanupIdempotencyKey = Schema.decodeUnknownSync(
  reservationHoldCleanupIdempotencyKeySchema
);

const ReservationHoldCleanupSchedulePayloadSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  orderId: workspaceReservationIdSchema,
  reservationHoldExpiresAtIso: instantStringSchema,
});

type ReservationHoldCleanupSchedulePayload =
  typeof ReservationHoldCleanupSchedulePayloadSchema.Encoded;

type ReservationHoldCleanupScheduleMessage = {
  readonly topic: typeof reservationHoldCleanupQueueTopic;
  readonly payload: ReservationHoldCleanupSchedulePayload;
  readonly options: {
    readonly delaySeconds: number;
    readonly retentionSeconds: number;
    readonly idempotencyKey: ReservationHoldCleanupIdempotencyKey;
  };
};

type ReservationHoldCleanupEnqueueResult = "duplicate" | "enqueued";

class ReservationHoldCleanupScheduleError extends Data.TaggedError(
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

/** Redelivers the message once the provider's abandonment window ends. */
class ReservationHoldCleanupDeferredError extends Data.TaggedError(
  "ReservationHoldCleanupDeferredError"
)<{
  readonly abandonmentCutoff: Temporal.Instant;
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
  readonly enqueueCleanup: (input: {
    readonly orderId: WorkspaceReservationId;
    readonly reservationHoldExpiresAt: Temporal.Instant;
  }) => Effect.Effect<void, ReservationHoldCleanupScheduleError>;
}

export const getReservationHoldCleanupScheduleMessage = (
  input: {
    readonly orderId: WorkspaceReservationId;
    readonly reservationHoldExpiresAt: Temporal.Instant;
  },
  now = Temporal.Now.instant()
): ReservationHoldCleanupScheduleMessage => {
  const reservationHoldExpiresAtIso = toStoredInstant(
    input.reservationHoldExpiresAt
  ).toString();
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
      schemaVersion: 1,
      orderId: input.orderId,
      reservationHoldExpiresAtIso,
    } satisfies ReservationHoldCleanupSchedulePayload,
    options: {
      delaySeconds,
      retentionSeconds,
      idempotencyKey: makeReservationHoldCleanupIdempotencyKey(
        `reservation-hold-cleanup:${input.orderId}:${reservationHoldExpiresAtIso}`
      ),
    },
  };
};

export function makeReservationHoldCleanupScheduleService(
  sendMessage: typeof send = send
): IReservationHoldCleanupScheduleService {
  return {
    enqueueCleanup: Effect.fn("reservationHoldCleanupSchedule.enqueueCleanup")(
      function* (input) {
        const message = getReservationHoldCleanupScheduleMessage(input);
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
  static Default = Layer.succeed(
    this,
    makeReservationHoldCleanupScheduleService()
  );
}

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
  reservation.reservationHoldExpiresAt !== null &&
  toStoredInstant(reservation.reservationHoldExpiresAt).equals(
    toStoredInstant(reservationHoldExpiresAt)
  ) &&
  Temporal.Instant.compare(reservation.reservationHoldExpiresAt, now) <= 0;

export const processReservationHoldCleanupScheduleMessage = Effect.fn(
  "reservationHoldCleanupSchedule.processMessage"
)(function* (
  message: Parameters<typeof decodeSchedulePayload>[0],
  now = Temporal.Now.instant()
) {
  const payload = Option.getOrUndefined(decodeSchedulePayload(message));
  if (!payload) {
    yield* Effect.logWarning(
      "Reservation hold cleanup queue message ignored: invalid payload"
    );
    return "ignored" as const;
  }

  const reservationHoldExpiresAt = Temporal.Instant.from(
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
    .cancelOrderHold({ orderId: payload.orderId, checkedAt: now })
    .pipe(
      Effect.mapError(
        ReservationHoldCleanupScheduleError.fromError(
          "Queued reservation hold cleanup failed."
        )
      )
    );

  if (outcome instanceof ProviderPaymentDeferral) {
    yield* Effect.logInfo(
      "Reservation hold cleanup queue message deferred until provider cutoff",
      { payload, abandonmentCutoff: outcome.abandonmentCutoff }
    );
    return yield* new ReservationHoldCleanupDeferredError({
      abandonmentCutoff: outcome.abandonmentCutoff,
    });
  }

  return outcome satisfies ReservationHoldCleanupOutcome;
});

/** Classifies a failed delivery; the route's Layer failures stay unclassified. */
export const reservationHoldCleanupRedelivery = (cause: unknown) =>
  cause instanceof ReservationHoldCleanupDeferredError
    ? QueueRedelivery.At({ instant: cause.abandonmentCutoff })
    : QueueRedelivery.Default();
