import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { WorkspaceReservation } from "@/db/schema";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "./reservation-hold-cleanup.service";

const now = Temporal.Instant.from("2026-06-01T10:00:00.000Z");
const expiresAt = Temporal.Instant.from("2026-06-01T10:10:00.000Z");
const dueNow = Temporal.Instant.from("2026-06-01T10:10:00.000Z");

const makeReservation = (
  overrides: Partial<WorkspaceReservation> = {}
): WorkspaceReservation =>
  ({
    id: "order-id",
    checkoutSessionKey: "session-key",
    checkoutAttemptKey: "attempt-key",
    correlationId: "correlation-id",
    dotyposCustomerId: "customer-id",
    dotyposReservationId: "dotypos-reservation-id",
    customerAccessCode: "",
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
    cancellationClaimOwner: null,
    cancellationClaimedAt: null,
    paidAt: null,
    fulfilledAt: null,
    fulfillmentFailedAt: null,
    failureCode: null,
    fulfillmentFailureCode: null,
    createdAt: Temporal.Instant.from("2026-06-01T09:55:00.000Z"),
    updatedAt: Temporal.Instant.from("2026-06-01T09:55:00.000Z"),
    ...overrides,
  }) as WorkspaceReservation;

const runProcessMessage = async (
  message: unknown,
  input: {
    readonly findById?: ReturnType<typeof mock>;
    readonly recordAttachmentCancellationHandoff?: ReturnType<typeof mock>;
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
  const recordAttachmentCancellationHandoff =
    input.recordAttachmentCancellationHandoff ??
    mock(() => Effect.succeed(makeReservation()));

  const result = await processReservationHoldCleanupScheduleMessage(
    message,
    input.now ?? now
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(WorkspaceReservationRepository, {
          findById,
          recordAttachmentCancellationHandoff,
        } as unknown as WorkspaceReservationRepositoryType),
        Layer.succeed(ReservationHoldCleanupService, {
          cancelOrderHold,
          sweepExpiredHolds: mock(() =>
            Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
          ),
        } satisfies ReservationHoldCleanupServiceType)
      )
    ),
    Effect.runPromise
  );

  return {
    result,
    findById,
    recordAttachmentCancellationHandoff,
    cancelOrderHold,
  };
};

const duePayload = {
  schemaVersion: 2,
  reason: "hold_expired",
  orderId: "order-id",
  reservationHoldExpiresAtIso: expiresAt.toString(),
};

const attachmentPayload = {
  schemaVersion: 2,
  reason: "attachment_compensation",
  orderId: "order-id",
  dotyposReservationId: "provider-reservation-id",
  reservationCreatedAtIso: now.toString(),
};

describe("ReservationHoldCleanupScheduleService", () => {
  test("durably hands attachment identity to both marker and queue", async () => {
    const {
      enqueueAttachmentCancellationCompensation,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const recordAttachmentCancellationHandoff = mock(() =>
      Effect.succeed(makeReservation())
    );
    const enqueueCleanup = mock(() => Effect.void);

    await enqueueAttachmentCancellationCompensation({
      orderId: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            recordAttachmentCancellationHandoff,
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupScheduleService, {
            enqueueCleanup,
          })
        )
      ),
      Effect.runPromise
    );

    expect(recordAttachmentCancellationHandoff).toHaveBeenCalledWith({
      id: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
      failureCode: "attach_failed_cancellation_required",
    });
    expect(enqueueCleanup).toHaveBeenCalledWith({
      reason: "attachment_compensation",
      orderId: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
    });
  });

  test("enqueues the exact attachment identity when the marker write fails", async () => {
    const {
      enqueueAttachmentCancellationCompensation,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const enqueueCleanup = mock(() => Effect.void);

    await enqueueAttachmentCancellationCompensation({
      orderId: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            recordAttachmentCancellationHandoff: mock(() =>
              Effect.fail(new Error("marker unavailable"))
            ),
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupScheduleService, {
            enqueueCleanup,
          })
        )
      ),
      Effect.runPromise
    );

    expect(enqueueCleanup).toHaveBeenCalledWith({
      reason: "attachment_compensation",
      orderId: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
    });
  });

  test("retains the database marker when attachment enqueue fails", async () => {
    const {
      enqueueAttachmentCancellationCompensation,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const recordAttachmentCancellationHandoff = mock(() =>
      Effect.succeed(makeReservation())
    );

    await enqueueAttachmentCancellationCompensation({
      orderId: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            recordAttachmentCancellationHandoff,
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupScheduleService, {
            enqueueCleanup: mock(() =>
              Effect.fail(new Error("queue unavailable"))
            ),
          })
        )
      ),
      Effect.runPromise
    );

    expect(recordAttachmentCancellationHandoff).toHaveBeenCalledTimes(1);
  });

  test("fails loudly when neither durable attachment handoff succeeds", async () => {
    const {
      AttachmentCancellationHandoffError,
      enqueueAttachmentCancellationCompensation,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );

    const error = await enqueueAttachmentCancellationCompensation({
      orderId: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            recordAttachmentCancellationHandoff: mock(() =>
              Effect.fail(new Error("marker unavailable"))
            ),
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupScheduleService, {
            enqueueCleanup: mock(() =>
              Effect.fail(new Error("queue unavailable"))
            ),
          })
        )
      ),
      Effect.flip,
      Effect.runPromise
    );

    expect(error).toBeInstanceOf(AttachmentCancellationHandoffError);
  });

  test("materializes an identity-bearing attachment message before cancellation", async () => {
    const recordAttachmentCancellationHandoff = mock(() =>
      Effect.succeed(
        makeReservation({
          reservationState: "cancellation_failed",
          cancellationRecoveryReason: "attachment_compensation",
        })
      )
    );
    const cancelOrderHold = mock(() => Effect.succeed("cancelled" as const));

    const result = await runProcessMessage(attachmentPayload, {
      recordAttachmentCancellationHandoff,
      cancelOrderHold,
    });

    expect(result.result).toBe("cancelled");
    expect(recordAttachmentCancellationHandoff).toHaveBeenCalledWith({
      id: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
      failureCode: "attach_failed_cancellation_required",
    });
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: "order-id",
      recoveryReason: "attachment_compensation",
    });
    expect(result.findById).not.toHaveBeenCalled();
  });

  test("duplicate attachment delivery and later state changes never reassign ownership", async () => {
    let delivery = 0;
    const recordAttachmentCancellationHandoff = mock(() =>
      Effect.succeed(
        delivery++ === 0
          ? makeReservation({
              reservationState: "cancellation_failed",
              cancellationRecoveryReason: "attachment_compensation",
            })
          : null
      )
    );
    const cancelOrderHold = mock(() => Effect.succeed("cancelled" as const));

    const first = await runProcessMessage(attachmentPayload, {
      recordAttachmentCancellationHandoff,
      cancelOrderHold,
    });
    const duplicate = await runProcessMessage(attachmentPayload, {
      recordAttachmentCancellationHandoff,
      cancelOrderHold,
    });

    expect(first.result).toBe("cancelled");
    expect(duplicate.result).toBe("ignored");
    expect(cancelOrderHold).toHaveBeenCalledTimes(1);
  });

  test("builds bounded delayed queue messages with idempotency", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
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
        idempotencyKey: `reservation-hold-cleanup:order-id:${expiresAt.toString()}`,
      },
    });
    expect(
      getAttachmentCancellationScheduleMessage({
        orderId: "order-id",
        dotyposReservationId: "provider-reservation-id",
        reservationCreatedAt: now,
      })
    ).toEqual({
      topic: reservationHoldCleanupQueueTopic,
      payload: attachmentPayload,
      options: {
        delaySeconds: 0,
        retentionSeconds: 604_800,
        idempotencyKey:
          "reservation-attachment-cancellation:order-id:provider-reservation-id",
      },
    });

    const clamped = getReservationHoldCleanupScheduleMessage(
      {
        orderId: "order-id",
        reservationHoldExpiresAt: Temporal.Instant.from(
          "2026-06-09T10:00:01.000Z"
        ),
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

  test("keeps enqueue failure causes visible in structured logs", async () => {
    const { makeReservationHoldCleanupScheduleService } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const source = new Error("queue unavailable");
    const service = makeReservationHoldCleanupScheduleService(
      mock(() => Promise.reject(source)) as never
    );
    const error = await service
      .enqueueCleanup({
        reason: "hold_expired",
        orderId: "order-id",
        reservationHoldExpiresAt: expiresAt,
      })
      .pipe(Effect.flip, Effect.runPromise);

    expect(error.message).toBe(
      "Reservation hold cleanup could not be enqueued."
    );
    expect(error.cause).toMatchObject({
      name: "Error",
      message: "queue unavailable",
    });
    expect(error.cause).not.toBe(source);
  });

  test("ignores invalid, not-due, changed-expiry, and completed reservations", async () => {
    const invalid = await runProcessMessage({ schemaVersion: 2 });
    expect(invalid.result).toBe("ignored");
    expect(invalid.findById).not.toHaveBeenCalled();

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
      recoveryReason: "hold_expired",
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
        recoveryReason: "hold_expired",
        holdExpiredAt: dueNow,
      });
    }
  });

  test("keeps version-one hold-expiry messages recoverable", async () => {
    const cancelOrderHold = mock(() => Effect.succeed("cancelled" as const));
    const result = await runProcessMessage(
      {
        schemaVersion: 1,
        orderId: "order-id",
        reservationHoldExpiresAtIso: expiresAt.toString(),
      },
      { cancelOrderHold, now: dueNow }
    );

    expect(result.result).toBe("cancelled");
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: "order-id",
      recoveryReason: "hold_expired",
      holdExpiredAt: dueNow,
    });
  });

  test("acks skipped cleanup while the reservation is still due", async () => {
    const cancelOrderHold = mock(() => Effect.succeed("skipped" as const));
    const findById = mock(() => Effect.succeed(makeReservation()));

    const result = await runProcessMessage(duePayload, {
      cancelOrderHold,
      findById,
      now: dueNow,
    });

    expect(result.result).toBe("skipped");
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: "order-id",
      recoveryReason: "hold_expired",
      holdExpiredAt: dueNow,
    });
    expect(findById).toHaveBeenCalledTimes(1);
  });

  test("vercel config wires the queue trigger and daily repair cron", async () => {
    const { reservationHoldCleanupQueueTopic } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const config = await Bun.file(
      new URL("../../../../vercel.json", import.meta.url)
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

    const queueRoute = await Bun.file(
      new URL(
        "../../../../app/api/queues/workspace/reservation-hold-cleanup/route.ts",
        import.meta.url
      )
    ).text();
    const cronRoute = await Bun.file(
      new URL(
        "../../../../app/api/cron/workspace/reservation-holds/route.ts",
        import.meta.url
      )
    ).text();
    expect(queueRoute).toContain(
      "processReservationHoldCleanupScheduleMessage(message)"
    );
    expect(cronRoute).toContain("cleanup.sweepExpiredHolds(input)");
  });
});
