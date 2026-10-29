import { Context, Data, Duration, Effect, Layer, Schema } from "effect";
import { toStoredInstant } from "@/db/instant";
import type { WorkspaceReservationRow } from "@/db/schema";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { QueueRedelivery } from "@/shared/backend/queue/queue-consumer";
import {
  QueuePublisher,
  type QueuePublishOutcome,
} from "@/shared/backend/queue/queue-publisher";
import { defineQueueTopic } from "@/shared/backend/queue/queue-topic";
import { clamp } from "@/shared/utils";
import { instantStringSchema } from "@/shared/utils/temporal";
import { ProviderPaymentDeferral } from "../payment/provider-payment-finalization.service";
import {
  type ReservationHoldCleanupOutcome,
  ReservationHoldCleanupService,
} from "./reservation-hold-cleanup.service";

export const reservationHoldCleanupScheduleMaxDelaySeconds = 7 * 24 * 60 * 60;
const reservationHoldCleanupRetryWindowSeconds = 60 * 60;

const ReservationHoldCleanupSchedulePayloadSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  orderId: workspaceReservationIdSchema,
  reservationHoldExpiresAtIso: instantStringSchema,
});

type ReservationHoldCleanupSchedulePayload =
  typeof ReservationHoldCleanupSchedulePayloadSchema.Type;

type ReservationHoldCleanupSchedule = {
  readonly orderId: WorkspaceReservationId;
  readonly reservationHoldExpiresAt: Temporal.Instant;
};

/**
 * One message per hold deadline, delivered when the hold expires and kept for
 * an hour of retries after it.
 */
export const reservationHoldCleanupTopic = defineQueueTopic({
  topic: "workspace-reservation-hold-cleanup",
  label: "Reservation hold cleanup",
  message: Schema.toStandardSchemaV1(
    ReservationHoldCleanupSchedulePayloadSchema
  ),
  publish: (
    input: ReservationHoldCleanupSchedule & { readonly now: Temporal.Instant }
  ) => {
    const reservationHoldExpiresAtIso = toStoredInstant(
      input.reservationHoldExpiresAt
    ).toString();
    const delaySeconds = clamp(
      Math.ceil(
        (input.reservationHoldExpiresAt.epochMilliseconds -
          input.now.epochMilliseconds) /
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
      message: {
        schemaVersion: 1 as const,
        orderId: input.orderId,
        reservationHoldExpiresAtIso,
      },
      key: `reservation-hold-cleanup:${input.orderId}:${reservationHoldExpiresAtIso}`,
      delay: Duration.seconds(delaySeconds),
      retention: Duration.seconds(retentionSeconds),
    };
  },
});

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

interface IReservationHoldCleanupScheduleService {
  readonly enqueueCleanup: (
    input: ReservationHoldCleanupSchedule
  ) => Effect.Effect<void, ReservationHoldCleanupScheduleError>;
}

const enqueueOutcomeMessages = {
  duplicate: "Reservation hold cleanup was already enqueued",
  published: "Reservation hold cleanup enqueued",
} satisfies Record<QueuePublishOutcome, string>;

export class ReservationHoldCleanupScheduleService extends Context.Service<
  ReservationHoldCleanupScheduleService,
  IReservationHoldCleanupScheduleService
>()("ReservationHoldCleanupScheduleService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const publisher = yield* QueuePublisher;
      return {
        enqueueCleanup: Effect.fn(
          "reservationHoldCleanupSchedule.enqueueCleanup"
        )(function* (input) {
          const schedule = { ...input, now: Temporal.Now.instant() };
          const publication = reservationHoldCleanupTopic.publication(schedule);
          // Keeps the log fields these lines had before the topic definition.
          const message = {
            topic: publication.topic,
            payload: publication.message,
            options: publication.options,
          };
          yield* Effect.logInfo("Reservation hold cleanup enqueue started", {
            message,
          });

          const outcome = yield* reservationHoldCleanupTopic
            .publish(schedule)
            .pipe(
              Effect.provideService(QueuePublisher, publisher),
              Effect.mapError((error) =>
                ReservationHoldCleanupScheduleError.fromError(
                  "Reservation hold cleanup could not be enqueued."
                )(error.cause)
              )
            );

          yield* Effect.logInfo(enqueueOutcomeMessages[outcome], { message });
        }),
      };
    })
  );

  static Live = this.Default.pipe(Layer.provide(QueuePublisher.Default));
}

const dueReservationStates = ["held", "cancelling", "cancellation_failed"];

const isDueReservation = (
  reservation: WorkspaceReservationRow | null,
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
  payload: ReservationHoldCleanupSchedulePayload,
  now = Temporal.Now.instant()
) {
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
