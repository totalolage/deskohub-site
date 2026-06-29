import { DuplicateMessageError, send } from "@vercel/queue";
import { Context, Data, Effect, Layer } from "effect";
import type { WorkspaceReservation } from "@/db/schema";
import {
  type ReservationHoldCleanupOutcome,
  ReservationHoldCleanupService,
} from "@/features/checkout/backend/reservation-hold-cleanup.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";

export const reservationHoldCleanupQueueTopic =
  "workspace-reservation-hold-cleanup";

export const reservationHoldCleanupQueueMaxDelaySeconds = 7 * 24 * 60 * 60;
const reservationHoldCleanupRetryWindowSeconds = 60 * 60;

export type ReservationHoldCleanupQueuePayload = {
  readonly schemaVersion: 1;
  readonly orderId: string;
  readonly reservationHoldExpiresAtIso: string;
};

export class ReservationHoldCleanupQueueError extends Data.TaggedError(
  "ReservationHoldCleanupQueueError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface IReservationHoldCleanupQueueService {
  readonly enqueueCleanup: (input: {
    readonly orderId: string;
    readonly reservationHoldExpiresAt: Date;
  }) => Effect.Effect<void, ReservationHoldCleanupQueueError>;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const getReservationHoldCleanupQueueMessage = (
  input: {
    readonly orderId: string;
    readonly reservationHoldExpiresAt: Date;
  },
  now = new Date()
) => {
  const reservationHoldExpiresAtIso =
    input.reservationHoldExpiresAt.toISOString();
  const delaySeconds = clamp(
    Math.ceil(
      (input.reservationHoldExpiresAt.getTime() - now.getTime()) / 1000
    ),
    0,
    reservationHoldCleanupQueueMaxDelaySeconds
  );
  const retentionSeconds = clamp(
    delaySeconds + reservationHoldCleanupRetryWindowSeconds,
    60,
    reservationHoldCleanupQueueMaxDelaySeconds
  );

  return {
    topic: reservationHoldCleanupQueueTopic,
    payload: {
      schemaVersion: 1,
      orderId: input.orderId,
      reservationHoldExpiresAtIso,
    } satisfies ReservationHoldCleanupQueuePayload,
    options: {
      delaySeconds,
      retentionSeconds,
      idempotencyKey: `reservation-hold-cleanup:${input.orderId}:${reservationHoldExpiresAtIso}`,
    },
  };
};

export class ReservationHoldCleanupQueueService extends Context.Service<
  ReservationHoldCleanupQueueService,
  IReservationHoldCleanupQueueService
>()("ReservationHoldCleanupQueueService") {
  static Live = Layer.succeed(this, {
    enqueueCleanup: Effect.fn("reservationHoldCleanupQueue.enqueueCleanup")(
      function* (input) {
        const message = getReservationHoldCleanupQueueMessage(input);
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
            (cause) =>
              new ReservationHoldCleanupQueueError({
                message: "Reservation hold cleanup could not be enqueued.",
                cause,
              })
          )
        );

        yield* Effect.logInfo(
          result === "duplicate"
            ? "Reservation hold cleanup was already enqueued"
            : "Reservation hold cleanup enqueued",
          { message }
        );
      }
    ),
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseQueuePayload = (
  message: unknown
): ReservationHoldCleanupQueuePayload | undefined => {
  if (!isRecord(message)) return undefined;
  if (message.schemaVersion !== 1) return undefined;
  if (typeof message.orderId !== "string") return undefined;
  if (typeof message.reservationHoldExpiresAtIso !== "string") {
    return undefined;
  }

  return {
    schemaVersion: 1,
    orderId: message.orderId,
    reservationHoldExpiresAtIso: message.reservationHoldExpiresAtIso,
  };
};

const parseIsoDate = (value: string): Date | undefined => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const isDueReservation = (
  reservation: WorkspaceReservation | null,
  reservationHoldExpiresAt: Date,
  now: Date
) =>
  (reservation?.reservationState === "held" ||
    reservation?.reservationState === "cancelling" ||
    reservation?.reservationState === "cancellation_failed") &&
  reservation.paymentState !== "paid" &&
  reservation.reservationHoldExpiresAt?.getTime() ===
    reservationHoldExpiresAt.getTime() &&
  reservation.reservationHoldExpiresAt <= now;

export const processReservationHoldCleanupQueueMessage = Effect.fn(
  "reservationHoldCleanupQueue.processMessage"
)(function* (message: unknown, now = new Date()) {
  const payload = parseQueuePayload(message);
  if (!payload) {
    yield* Effect.logWarning(
      "Reservation hold cleanup queue message ignored: invalid payload"
    );
    return "ignored" as const;
  }

  const reservationHoldExpiresAt = parseIsoDate(
    payload.reservationHoldExpiresAtIso
  );
  if (!reservationHoldExpiresAt) {
    yield* Effect.logWarning(
      "Reservation hold cleanup queue message ignored: invalid expiry",
      { payload }
    );
    return "ignored" as const;
  }

  const reservations = yield* WorkspaceReservationRepository;
  const cleanup = yield* ReservationHoldCleanupService;
  const reservation = yield* reservations.findById(payload.orderId).pipe(
    Effect.mapError(
      (cause) =>
        new ReservationHoldCleanupQueueError({
          message: "Queued reservation hold cleanup state could not be loaded.",
          cause,
        })
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
        (cause) =>
          new ReservationHoldCleanupQueueError({
            message: "Queued reservation hold cleanup failed.",
            cause,
          })
      )
    );

  if (outcome === "skipped") {
    const current = yield* reservations.findById(payload.orderId).pipe(
      Effect.mapError(
        (cause) =>
          new ReservationHoldCleanupQueueError({
            message:
              "Queued reservation hold cleanup state could not be reloaded.",
            cause,
          })
      )
    );

    if (isDueReservation(current, reservationHoldExpiresAt, now)) {
      return yield* Effect.fail(
        new ReservationHoldCleanupQueueError({
          message: "Queued reservation hold cleanup skipped while still due.",
        })
      );
    }
  }

  return outcome satisfies ReservationHoldCleanupOutcome;
});
