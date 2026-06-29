import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { WorkspaceReservation } from "@/db/schema";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "@/features/checkout/backend/reservation-hold-cleanup.service";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";

const now = new Date("2026-06-01T10:00:00.000Z");
const expiresAt = new Date("2026-06-01T10:10:00.000Z");
const dueNow = new Date("2026-06-01T10:10:00.000Z");

const makeReservation = (
  overrides: Partial<WorkspaceReservation> = {}
): WorkspaceReservation =>
  ({
    id: "order-id",
    reservationIntentKey: "intent-key",
    correlationId: "correlation-id",
    dotyposCustomerId: "customer-id",
    dotyposReservationId: "dotypos-reservation-id",
    customerAccessCode: "ACCESS-123",
    reservationState: "held",
    paymentState: "not_started",
    fulfillmentState: "not_started",
    activePaymentAttemptId: null,
    productTier: "basic",
    productCoffee: false,
    productMonitorOption: null,
    locale: "en-US",
    reservationHoldExpiresAt: expiresAt,
    reservationHoldExpiredAt: null,
    reservationCreatedAt: new Date("2026-06-01T09:55:00.000Z"),
    reservationConfirmedAt: null,
    reservationCancelledAt: null,
    paidAt: null,
    fulfilledAt: null,
    fulfillmentFailedAt: null,
    failureCode: null,
    fulfillmentFailureCode: null,
    createdAt: new Date("2026-06-01T09:55:00.000Z"),
    updatedAt: new Date("2026-06-01T09:55:00.000Z"),
    ...overrides,
  }) as WorkspaceReservation;

const runProcessMessage = async (
  message: unknown,
  input: {
    readonly findById?: ReturnType<typeof mock>;
    readonly cancelOrderHold?: ReturnType<typeof mock>;
    readonly now?: Date;
  } = {}
) => {
  const { ReservationHoldCleanupService } = await import(
    "@/features/checkout/backend/reservation-hold-cleanup.service"
  );
  const { processReservationHoldCleanupScheduleMessage } = await import(
    "./reservation-hold-cleanup-queue.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const findById =
    input.findById ?? mock(() => Effect.succeed(makeReservation()));
  const cancelOrderHold =
    input.cancelOrderHold ?? mock(() => Effect.succeed("cancelled" as const));

  const result = await processReservationHoldCleanupScheduleMessage(
    message,
    input.now ?? now
  ).pipe(
    Effect.provide(
      Layer.succeed(WorkspaceReservationRepository, {
        findById,
      } as unknown as WorkspaceReservationRepositoryType)
    ),
    Effect.provide(
      Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold,
        sweepExpiredHolds: mock(() =>
          Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
        ),
      } satisfies ReservationHoldCleanupServiceType)
    ),
    Effect.runPromise
  );

  return { result, findById, cancelOrderHold };
};

const duePayload = {
  schemaVersion: 1,
  orderId: "order-id",
  reservationHoldExpiresAtIso: expiresAt.toISOString(),
};

describe("ReservationHoldCleanupScheduleService", () => {
  test("builds bounded delayed queue messages with idempotency", async () => {
    const {
      getReservationHoldCleanupScheduleMessage,
      reservationHoldCleanupScheduleMaxDelaySeconds,
      reservationHoldCleanupQueueTopic,
    } = await import("./reservation-hold-cleanup-queue.service");

    const message = getReservationHoldCleanupScheduleMessage(
      { orderId: "order-id", reservationHoldExpiresAt: expiresAt },
      now
    );
    expect(message).toEqual({
      topic: reservationHoldCleanupQueueTopic,
      payload: duePayload,
      options: {
        delaySeconds: 600,
        retentionSeconds: 4200,
        idempotencyKey: `reservation-hold-cleanup:order-id:${expiresAt.toISOString()}`,
      },
    });

    const clamped = getReservationHoldCleanupScheduleMessage(
      {
        orderId: "order-id",
        reservationHoldExpiresAt: new Date("2026-06-09T10:00:01.000Z"),
      },
      now
    );
    expect(clamped.options.delaySeconds).toBe(
      reservationHoldCleanupScheduleMaxDelaySeconds
    );
    expect(clamped.options.retentionSeconds).toBe(
      reservationHoldCleanupScheduleMaxDelaySeconds
    );
  });

  test("treats duplicate queue messages as already enqueued", async () => {
    const source = await Bun.file(
      new URL("./reservation-hold-cleanup-queue.service.ts", import.meta.url)
    ).text();

    expect(source).toContain("DuplicateMessageError");
    expect(source).toContain("cause instanceof DuplicateMessageError");
    expect(source).toContain('Effect.succeed("duplicate" as const)');
  });

  test("ignores invalid, not-due, changed-expiry, and completed reservations", async () => {
    const invalid = await runProcessMessage({ schemaVersion: 2 });
    expect(invalid.result).toBe("ignored");
    expect(invalid.findById).not.toHaveBeenCalled();

    const notDue = mock(() =>
      Effect.succeed(
        makeReservation({
          reservationHoldExpiresAt: new Date("2026-06-01T10:11:00.000Z"),
        })
      )
    );
    const notDueResult = await runProcessMessage(duePayload, {
      findById: notDue,
    });
    expect(notDueResult.result).toBe("ignored");
    expect(notDueResult.cancelOrderHold).not.toHaveBeenCalled();

    for (const reservation of [
      makeReservation({ paymentState: "paid" }),
      makeReservation({ reservationState: "cancelled" }),
      makeReservation({ reservationState: "confirmed" }),
    ]) {
      const result = await runProcessMessage(duePayload, {
        findById: mock(() => Effect.succeed(reservation)),
      });
      expect(result.result).toBe("ignored");
      expect(result.cancelOrderHold).not.toHaveBeenCalled();
    }
  });

  test("cancels due reservation holds", async () => {
    const cancelOrderHold = mock(() => Effect.succeed("cancelled" as const));
    const result = await runProcessMessage(duePayload, {
      cancelOrderHold,
      now: dueNow,
    });

    expect(result.result).toBe("cancelled");
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: "order-id",
      holdExpiredAt: dueNow,
    });

    for (const reservationState of [
      "cancelling",
      "cancellation_failed",
    ] as const) {
      const retryCancelOrderHold = mock(() =>
        Effect.succeed("cancelled" as const)
      );
      const retryResult = await runProcessMessage(duePayload, {
        cancelOrderHold: retryCancelOrderHold,
        findById: mock(() =>
          Effect.succeed(makeReservation({ reservationState }))
        ),
        now: dueNow,
      });

      expect(retryResult.result).toBe("cancelled");
      expect(retryCancelOrderHold).toHaveBeenCalledWith({
        orderId: "order-id",
        holdExpiredAt: dueNow,
      });
    }
  });

  test("retries skipped cleanup while the reservation is still due", async () => {
    const { ReservationHoldCleanupScheduleError } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const { ReservationHoldCleanupService } = await import(
      "@/features/checkout/backend/reservation-hold-cleanup.service"
    );
    const { processReservationHoldCleanupScheduleMessage } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );

    const error = await processReservationHoldCleanupScheduleMessage(
      duePayload,
      dueNow
    ).pipe(
      Effect.provide(
        Layer.succeed(WorkspaceReservationRepository, {
          findById: mock(() => Effect.succeed(makeReservation())),
        } as unknown as WorkspaceReservationRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(ReservationHoldCleanupService, {
          cancelOrderHold: mock(() => Effect.succeed("skipped" as const)),
          sweepExpiredHolds: mock(() =>
            Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
          ),
        } satisfies ReservationHoldCleanupServiceType)
      ),
      Effect.flip,
      Effect.runPromise
    );

    expect(error).toBeInstanceOf(ReservationHoldCleanupScheduleError);
    expect(error.message).toBe(
      "Queued reservation hold cleanup skipped while still due."
    );
  });

  test("vercel config wires the queue trigger and daily repair cron", async () => {
    const { reservationHoldCleanupQueueTopic } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const config = await Bun.file(
      new URL("../../../vercel.json", import.meta.url)
    ).json();

    expect(config.crons).toContainEqual({
      path: "/api/cron/workspace/reservation-holds",
      schedule: "0 0 * * *",
    });
    expect(
      config.functions[
        "app/api/queues/workspace/reservation-hold-cleanup/route.ts"
      ].experimentalTriggers
    ).toContainEqual({
      type: "queue/v2beta",
      topic: reservationHoldCleanupQueueTopic,
      retryAfterSeconds: 60,
      initialDelaySeconds: 0,
    });
  });
});
