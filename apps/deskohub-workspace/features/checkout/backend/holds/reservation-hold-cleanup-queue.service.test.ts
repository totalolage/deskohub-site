import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Logger } from "effect";
import type { WorkspaceReservationRow } from "@/db/schema";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "./reservation-hold-cleanup.service";

const now = Temporal.Instant.from("2026-06-01T10:00:00.000Z");
const expiresAt = Temporal.Instant.from("2026-06-01T10:10:00.000Z");
const dueNow = Temporal.Instant.from("2026-06-01T10:10:00.000Z");

const makeReservation = (
  overrides: Partial<WorkspaceReservationRow> = {}
): WorkspaceReservationRow =>
  ({
    id: "order-id",
    checkoutSessionKey: "session-key",
    checkoutAttemptKey: "attempt-key",
    correlationId: "correlation-id",
    dotyposCustomerId: "customer-id",
    dotyposReservationId: "dotypos-reservation-id",
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
    reservationCreatedAt: Temporal.Instant.from("2026-06-01T09:55:00.000Z"),
    reservationConfirmedAt: null,
    reservationCancelledAt: null,
    paidAt: null,
    fulfilledAt: null,
    fulfillmentFailedAt: null,
    failureCode: null,
    fulfillmentFailureCode: null,
    createdAt: Temporal.Instant.from("2026-06-01T09:55:00.000Z"),
    updatedAt: Temporal.Instant.from("2026-06-01T09:55:00.000Z"),
    ...overrides,
  }) as WorkspaceReservationRow;

const runProcessMessage = async (
  message: Parameters<
    typeof import("./reservation-hold-cleanup-queue.service").processReservationHoldCleanupScheduleMessage
  >[0],
  input: {
    readonly findById?: ReturnType<typeof mock>;
    readonly cancelOrderHold?: ReturnType<typeof mock>;
    readonly now?: Temporal.Instant;
  } = {}
) => {
  const { ReservationHoldCleanupService } = await import(
    "./reservation-hold-cleanup.service"
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
      Layer.mergeAll(
        Layer.mock(WorkspaceReservationRepository, {
          findById,
        }),
        Layer.mock(ReservationHoldCleanupService, {
          cancelOrderHold,
          sweepExpiredHolds: mock(() =>
            Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
          ),
        } satisfies ReservationHoldCleanupServiceType)
      )
    ),
    Effect.runPromise
  );

  return { result, findById, cancelOrderHold };
};

const duePayload = {
  schemaVersion: 1,
  orderId: "order-id",
  reservationHoldExpiresAtIso: expiresAt.toString(),
};

describe("ReservationHoldCleanupScheduleService", () => {
  test("builds bounded delayed queue messages with idempotency", async () => {
    const {
      reservationHoldCleanupScheduleMaxDelaySeconds,
      reservationHoldCleanupTopic,
    } = await import("./reservation-hold-cleanup-queue.service");

    const message = reservationHoldCleanupTopic.publication({
      orderId: "order-id" as WorkspaceReservationId,
      reservationHoldExpiresAt: expiresAt,
      now,
    });
    expect(message).toEqual({
      topic: "workspace-reservation-hold-cleanup",
      message: duePayload,
      options: {
        delaySeconds: 600,
        retentionSeconds: 4200,
        idempotencyKey:
          "reservation-hold-cleanup:order-id:2026-06-01T10:10:00Z",
      },
    });
    expect(JSON.stringify(message.message)).toBe(
      '{"schemaVersion":1,"orderId":"order-id","reservationHoldExpiresAtIso":"2026-06-01T10:10:00Z"}'
    );

    const clamped = reservationHoldCleanupTopic.publication({
      orderId: "order-id" as WorkspaceReservationId,
      reservationHoldExpiresAt: Temporal.Instant.from(
        "2026-06-09T10:00:01.000Z"
      ),
      now,
    });
    expect(clamped.options.delaySeconds).toBe(
      reservationHoldCleanupScheduleMaxDelaySeconds
    );
    expect(clamped.options.retentionSeconds).toBe(
      reservationHoldCleanupScheduleMaxDelaySeconds
    );
  });

  test("treats duplicate queue messages as already enqueued", async () => {
    const { ReservationHoldCleanupScheduleService } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const { makeMemoryQueue } = await import(
      "@/shared/backend/queue/memory-queue.test-utils"
    );
    const queue = makeMemoryQueue();
    const logs: Array<{ message: unknown; fields: unknown }> = [];
    const captureLogs = Logger.layer([
      Logger.make(({ message }) => {
        const [text, fields] = Array.isArray(message) ? message : [message];
        logs.push({ message: text, fields });
      }),
    ]);
    const enqueue = () =>
      Effect.flatMap(ReservationHoldCleanupScheduleService, (service) =>
        service.enqueueCleanup({
          orderId: "order-id" as WorkspaceReservationId,
          reservationHoldExpiresAt: expiresAt,
        })
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ReservationHoldCleanupScheduleService.Default.pipe(
              Layer.provide(queue.layer)
            ),
            captureLogs
          )
        ),
        Effect.runPromise
      );

    // The second enqueue resolves instead of failing with a schedule error.
    await enqueue();
    await enqueue();
    expect(queue.published()).toHaveLength(1);
    expect(logs.map(({ message }) => message)).toEqual([
      "Reservation hold cleanup enqueue started",
      "Reservation hold cleanup enqueued",
      "Reservation hold cleanup enqueue started",
      "Reservation hold cleanup was already enqueued",
    ]);
    // The logged message keeps its pre-topic shape.
    expect(logs[0]?.fields).toEqual({
      message: {
        topic: "workspace-reservation-hold-cleanup",
        payload: duePayload,
        options: queue.published()[0]?.options,
      },
    });
  });

  test("decodes only well-formed messages", async () => {
    const { reservationHoldCleanupTopic } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const { decodeStandardSchema } = await import("@deskohub/standard-schema");

    for (const message of [
      { ...duePayload, schemaVersion: 2 },
      { ...duePayload, orderId: "" },
      { ...duePayload, reservationHoldExpiresAtIso: "tomorrow" },
      { schemaVersion: 1, orderId: "order-id" },
    ]) {
      expect(
        decodeStandardSchema(reservationHoldCleanupTopic.message, message)
      ).toBeUndefined();
    }
    expect(
      decodeStandardSchema(reservationHoldCleanupTopic.message, duePayload)
    ).toEqual(duePayload);
  });

  test("ignores not-due, changed-expiry, and completed reservations", async () => {
    const notDue = mock(() =>
      Effect.succeed(
        makeReservation({
          reservationHoldExpiresAt: Temporal.Instant.from(
            "2026-06-01T10:11:00.000Z"
          ),
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
      checkedAt: dueNow,
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
        checkedAt: dueNow,
      });
    }
  });

  test("cancels a due hold whose deadline came from the nanosecond clock", async () => {
    const { reservationHoldCleanupTopic } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const { toStoredInstant } = await import("@/db/instant");
    // Temporal.Now has nanoseconds; the reservation row keeps microseconds.
    const clockExpiresAt = Temporal.Instant.from(
      "2026-06-01T10:10:00.123456789Z"
    );
    const storedReservation = makeReservation({
      reservationHoldExpiresAt: toStoredInstant(clockExpiresAt),
    });
    const { message } = reservationHoldCleanupTopic.publication({
      orderId: "order-id" as WorkspaceReservationId,
      reservationHoldExpiresAt: clockExpiresAt,
      now,
    });
    expect(message.reservationHoldExpiresAtIso).toBe(
      "2026-06-01T10:10:00.123456Z"
    );

    for (const payload of [
      message,
      // Messages enqueued before the payload was stored-precision.
      { ...duePayload, reservationHoldExpiresAtIso: clockExpiresAt.toString() },
    ]) {
      const cancelOrderHold = mock(() => Effect.succeed("cancelled" as const));
      const result = await runProcessMessage(payload, {
        cancelOrderHold,
        findById: mock(() => Effect.succeed(storedReservation)),
        now: dueNow.add({ seconds: 1 }),
      });

      expect(result.result).toBe("cancelled");
      expect(cancelOrderHold).toHaveBeenCalledTimes(1);
    }
  });

  test("redelivers cleanup at the provider cutoff while an empty order is inside it", async () => {
    const { ProviderPaymentDeferral } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { reservationHoldCleanupRedelivery } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const { QueueRedelivery } = await import(
      "@/shared/backend/queue/queue-consumer"
    );
    const abandonmentCutoff = dueNow.add({ minutes: 25 });
    const cancelOrderHold = mock(() =>
      Effect.succeed(new ProviderPaymentDeferral({ abandonmentCutoff }))
    );
    const retryNow = dueNow.add({ minutes: 20 });

    const failure = await runProcessMessage(duePayload, {
      cancelOrderHold,
      now: retryNow,
    }).then(
      () => undefined,
      (cause: unknown) => cause
    );

    expect(failure).toMatchObject({
      _tag: "ReservationHoldCleanupDeferredError",
      abandonmentCutoff,
    });
    expect(reservationHoldCleanupRedelivery(failure)).toEqual(
      QueueRedelivery.At({ instant: abandonmentCutoff })
    );
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: "order-id",
      checkedAt: retryNow,
    });
  });
});
