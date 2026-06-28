import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { DatabaseError } from "@/db/database.service";
import type { OperationalEventRepository as OperationalEventRepositoryType } from "@/features/checkout/backend/operational-event.repository";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "@/features/checkout/backend/payment-attempt.repository";
import type { ProviderPaymentFinalizationService as ProviderPaymentFinalizationServiceType } from "@/features/checkout/backend/provider-payment-finalization.service";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";

describe("ReservationHoldCleanupService", () => {
  test("fails the expired hold sweep when expired hold selection fails", async () => {
    const { OperationalEventRepository } = await import(
      "./operational-event.repository"
    );
    const { PaymentAttemptRepository } = await import(
      "./payment-attempt.repository"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "./provider-payment-finalization.service"
    );
    const { ReservationHoldCleanupService, ReservationHoldCleanupServiceLive } =
      await import("./reservation-hold-cleanup.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );

    const unused = () => Effect.die("not used");
    const selectExpiredHolds = mock(() =>
      Effect.fail(
        new DatabaseError({ operation: "selectExpiredHolds", cause: "down" })
      )
    );
    const reservations = {
      selectExpiredHolds,
    } as unknown as WorkspaceReservationRepositoryType;
    const dotypos = {} as unknown as typeof DotyposService.Service;

    const now = new Date("2026-06-02T10:00:00.000Z");
    const result = await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.sweepExpiredHolds({
        now,
        limit: 25,
      });
    }).pipe(
      Effect.provide(ReservationHoldCleanupServiceLive),
      Effect.provide(
        Layer.succeed(ProviderPaymentFinalizationService, {
          finalizePendingProviderPayment: unused,
        } satisfies ProviderPaymentFinalizationServiceType)
      ),
      Effect.provide(
        Layer.succeed(PaymentAttemptRepository, {
          markTerminalForReservation: unused,
        } as unknown as PaymentAttemptRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceReservationRepository, reservations)
      ),
      Effect.provide(
        Layer.succeed(OperationalEventRepository, {
          record: unused,
        } satisfies OperationalEventRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(PostHogEventService, { capture: () => Effect.void })
      ),
      Effect.provide(Layer.succeed(DotyposService, dotypos)),
      Effect.result,
      Effect.runPromise
    );

    expect(selectExpiredHolds).toHaveBeenCalledTimes(1);
    expect(selectExpiredHolds).toHaveBeenCalledWith({ now, limit: 25 });
    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected failure");
    expect(result.failure.message).toBe(
      "Expired reservation holds could not be selected."
    );
  });

  test("does not cancel an expired hold when the pending provider payment finalizes paid", async () => {
    const { OperationalEventRepository } = await import(
      "./operational-event.repository"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "./provider-payment-finalization.service"
    );
    const { PaymentAttemptRepository } = await import(
      "./payment-attempt.repository"
    );
    const { ReservationHoldCleanupService, ReservationHoldCleanupServiceLive } =
      await import("./reservation-hold-cleanup.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );

    const orderId = "reservation-cleanup-provider-paid";
    const attemptId = "attempt-cleanup-provider-paid";
    const cancelReservation = mock(() => Effect.void);
    const claimCancellation = mock(() => Effect.succeed(null));
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment: mock(() => Effect.succeed("paid")),
    };
    const reservations = {
      findById: mock(() =>
        Effect.succeed({
          id: orderId,
          reservationState: "held",
          paymentState: "pending",
          activePaymentAttemptId: attemptId,
        })
      ),
      claimCancellation,
    } as unknown as WorkspaceReservationRepositoryType;
    const operationalEvents: OperationalEventRepositoryType = {
      record: mock(() => Effect.die("not used")),
    };
    const dotypos = {
      cancelReservation,
    } as unknown as typeof DotyposService.Service;

    const outcome = await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.cancelOrderHold({
        orderId,
        holdExpiredAt: new Date("2026-06-02T10:00:00.000Z"),
      });
    }).pipe(
      Effect.provide(ReservationHoldCleanupServiceLive),
      Effect.provide(
        Layer.succeed(ProviderPaymentFinalizationService, finalization)
      ),
      Effect.provide(
        Layer.succeed(PaymentAttemptRepository, {
          markTerminalForReservation: mock(() => Effect.die("not used")),
        } as unknown as PaymentAttemptRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceReservationRepository, reservations)
      ),
      Effect.provide(
        Layer.succeed(OperationalEventRepository, operationalEvents)
      ),
      Effect.provide(
        Layer.succeed(PostHogEventService, { capture: () => Effect.void })
      ),
      Effect.provide(Layer.succeed(DotyposService, dotypos)),
      Effect.runPromise
    );

    expect(outcome).toBe("skipped");
    expect(finalization.finalizePendingProviderPayment).toHaveBeenCalledWith({
      orderId,
      paymentAttemptId: attemptId,
    });
    expect(claimCancellation).not.toHaveBeenCalled();
    expect(cancelReservation).not.toHaveBeenCalled();
  });

  test("counts unconfirmed pending payment cleanup as skipped and retries without cancelling", async () => {
    const { OperationalEventRepository } = await import(
      "./operational-event.repository"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "./provider-payment-finalization.service"
    );
    const { PaymentAttemptRepository } = await import(
      "./payment-attempt.repository"
    );
    const { ReservationHoldCleanupService, ReservationHoldCleanupServiceLive } =
      await import("./reservation-hold-cleanup.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );

    const orderId = "reservation-cleanup-provider-pending";
    const attemptId = "attempt-cleanup-provider-pending";
    const now = new Date("2026-06-02T10:00:00.000Z");
    const activeReservation = {
      id: orderId,
      reservationState: "held",
      paymentState: "pending",
      activePaymentAttemptId: attemptId,
    };
    const selectExpiredHolds = mock(() =>
      Effect.succeed([activeReservation] as never)
    );
    const recordHoldCleanupSkipped = mock(() => Effect.void);
    const claimCancellation = mock(() => Effect.die("not used"));
    const cancelReservation = mock(() => Effect.die("not used"));
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment: mock(() => Effect.succeed("pending")),
    };
    const reservations = {
      selectExpiredHolds,
      findById: mock(() => Effect.succeed(activeReservation as never)),
      recordHoldCleanupSkipped,
      claimCancellation,
    } as unknown as WorkspaceReservationRepositoryType;
    const operationalEvents: OperationalEventRepositoryType = {
      record: mock(() => Effect.succeed({} as never)),
    };
    const dotypos = {
      cancelReservation,
    } as unknown as typeof DotyposService.Service;

    const runSweep = () =>
      Effect.gen(function* () {
        const cleanup = yield* ReservationHoldCleanupService;
        return yield* cleanup.sweepExpiredHolds({ now, limit: 1 });
      }).pipe(
        Effect.provide(ReservationHoldCleanupServiceLive),
        Effect.provide(
          Layer.succeed(ProviderPaymentFinalizationService, finalization)
        ),
        Effect.provide(
          Layer.succeed(PaymentAttemptRepository, {
            markTerminalForReservation: mock(() => Effect.die("not used")),
          } as unknown as PaymentAttemptRepositoryType)
        ),
        Effect.provide(
          Layer.succeed(WorkspaceReservationRepository, reservations)
        ),
        Effect.provide(
          Layer.succeed(OperationalEventRepository, operationalEvents)
        ),
        Effect.provide(
          Layer.succeed(PostHogEventService, { capture: () => Effect.void })
        ),
        Effect.provide(Layer.succeed(DotyposService, dotypos)),
        Effect.runPromise
      );

    await expect(runSweep()).resolves.toEqual({
      cancelled: 0,
      skipped: 1,
      failed: 0,
    });
    await expect(runSweep()).resolves.toEqual({
      cancelled: 0,
      skipped: 1,
      failed: 0,
    });

    expect(recordHoldCleanupSkipped).toHaveBeenCalledTimes(2);
    expect(recordHoldCleanupSkipped).toHaveBeenCalledWith({
      id: orderId,
      holdExpiredAt: now,
      failureCode: "payment_outcome_unconfirmed_before_cleanup",
    });
    expect(finalization.finalizePendingProviderPayment).toHaveBeenCalledTimes(
      2
    );
    expect(claimCancellation).not.toHaveBeenCalled();
    expect(cancelReservation).not.toHaveBeenCalled();
  });

  test("expires a durable not-verifiable payment attempt before cancelling the hold", async () => {
    const { OperationalEventRepository } = await import(
      "./operational-event.repository"
    );
    const { PaymentAttemptRepository } = await import(
      "./payment-attempt.repository"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "./provider-payment-finalization.service"
    );
    const { ReservationHoldCleanupService, ReservationHoldCleanupServiceLive } =
      await import("./reservation-hold-cleanup.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );

    const orderId = "reservation-cleanup-not-verifiable";
    const attemptId = "attempt-cleanup-not-verifiable";
    const holdExpiredAt = new Date("2026-06-02T10:00:00.000Z");
    const claimed = {
      id: orderId,
      reservationState: "cancelling",
      paymentState: "expired",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
    };
    const claimCancellation = mock(() => Effect.succeed(claimed));
    const cancelReservation = mock(() => Effect.void);
    const markCancelled = mock(() => Effect.void);
    const markTerminalForReservation = mock(() =>
      Effect.succeed({
        attempt: { id: attemptId, state: "expired" },
        changed: true,
        timestamp: new Date(),
      })
    );
    const record = mock(() => Effect.void);

    await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.cancelOrderHold({ orderId, holdExpiredAt });
    }).pipe(
      Effect.provide(ReservationHoldCleanupServiceLive),
      Effect.provide(
        Layer.succeed(ProviderPaymentFinalizationService, {
          finalizePendingProviderPayment: mock(() =>
            Effect.succeed("not_verifiable")
          ),
        } satisfies ProviderPaymentFinalizationServiceType)
      ),
      Effect.provide(
        Layer.succeed(PaymentAttemptRepository, {
          markTerminalForReservation,
        } as unknown as PaymentAttemptRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceReservationRepository, {
          findById: mock(() =>
            Effect.succeed({
              id: orderId,
              reservationState: "held",
              paymentState: "pending",
              activePaymentAttemptId: attemptId,
            })
          ),
          claimCancellation,
          markCancelled,
        } as unknown as WorkspaceReservationRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(OperationalEventRepository, {
          record,
        } satisfies OperationalEventRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(PostHogEventService, { capture: () => Effect.void })
      ),
      Effect.provide(
        Layer.succeed(DotyposService, {
          cancelReservation,
        } as unknown as typeof DotyposService.Service)
      ),
      Effect.runPromise
    );

    expect(markTerminalForReservation).toHaveBeenCalledWith({
      id: attemptId,
      workspaceReservationId: orderId,
      state: "expired",
      failureCode: "payment_not_verifiable_before_cleanup",
    });
    expect(claimCancellation).toHaveBeenCalledWith(orderId);
    expect(cancelReservation).toHaveBeenCalledWith("dotypos-reservation-id");
    expect(markCancelled).toHaveBeenCalledWith({
      id: orderId,
      cancelledAt: expect.any(Date),
      holdExpiredAt,
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceReservationId: orderId,
        eventType: "workspace_reservation_hold_cancelled",
      })
    );
  });

  test("does not cancel when expiring the not-verifiable attempt loses the active-attempt guard", async () => {
    const { OperationalEventRepository } = await import(
      "./operational-event.repository"
    );
    const { PaymentAttemptRepository } = await import(
      "./payment-attempt.repository"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "./provider-payment-finalization.service"
    );
    const { ReservationHoldCleanupService, ReservationHoldCleanupServiceLive } =
      await import("./reservation-hold-cleanup.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );

    const orderId = "reservation-cleanup-stale-attempt";
    const attemptId = "attempt-cleanup-stale-attempt";
    const claimCancellation = mock(() => Effect.succeed(null));
    const cancelReservation = mock(() => Effect.void);
    const record = mock(() => Effect.void);

    await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.cancelOrderHold({ orderId });
    }).pipe(
      Effect.provide(ReservationHoldCleanupServiceLive),
      Effect.provide(
        Layer.succeed(ProviderPaymentFinalizationService, {
          finalizePendingProviderPayment: mock(() =>
            Effect.succeed("not_verifiable")
          ),
        } satisfies ProviderPaymentFinalizationServiceType)
      ),
      Effect.provide(
        Layer.succeed(PaymentAttemptRepository, {
          markTerminalForReservation: mock(() =>
            Effect.fail(new Error("stale"))
          ),
        } as unknown as PaymentAttemptRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceReservationRepository, {
          findById: mock(() =>
            Effect.succeed({
              id: orderId,
              reservationState: "held",
              paymentState: "pending",
              activePaymentAttemptId: attemptId,
            })
          ),
          claimCancellation,
        } as unknown as WorkspaceReservationRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(OperationalEventRepository, {
          record,
        } satisfies OperationalEventRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(PostHogEventService, { capture: () => Effect.void })
      ),
      Effect.provide(
        Layer.succeed(DotyposService, {
          cancelReservation,
        } as unknown as typeof DotyposService.Service)
      ),
      Effect.runPromise
    );

    expect(claimCancellation).not.toHaveBeenCalled();
    expect(cancelReservation).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceReservationId: orderId,
        paymentAttemptId: attemptId,
        eventType: "workspace_payment_outcome_unconfirmed_before_cleanup",
      })
    );
  });

  test("does not cancel an expired hold when provider verification fails transiently", async () => {
    const { OperationalEventRepository } = await import(
      "./operational-event.repository"
    );
    const { PaymentAttemptRepository } = await import(
      "./payment-attempt.repository"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "./provider-payment-finalization.service"
    );
    const { ReservationHoldCleanupService, ReservationHoldCleanupServiceLive } =
      await import("./reservation-hold-cleanup.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );

    const orderId = "reservation-cleanup-provider-failed";
    const attemptId = "attempt-cleanup-provider-failed";
    const markTerminalForReservation = mock(() => Effect.die("not used"));
    const claimCancellation = mock(() => Effect.succeed(null));
    const cancelReservation = mock(() => Effect.void);
    const record = mock(() => Effect.void);

    await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.cancelOrderHold({ orderId });
    }).pipe(
      Effect.provide(ReservationHoldCleanupServiceLive),
      Effect.provide(
        Layer.succeed(ProviderPaymentFinalizationService, {
          finalizePendingProviderPayment: mock(() =>
            Effect.succeed("provider_verification_failed")
          ),
        } satisfies ProviderPaymentFinalizationServiceType)
      ),
      Effect.provide(
        Layer.succeed(PaymentAttemptRepository, {
          markTerminalForReservation,
        } as unknown as PaymentAttemptRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceReservationRepository, {
          findById: mock(() =>
            Effect.succeed({
              id: orderId,
              reservationState: "held",
              paymentState: "pending",
              activePaymentAttemptId: attemptId,
            })
          ),
          claimCancellation,
        } as unknown as WorkspaceReservationRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(OperationalEventRepository, {
          record,
        } satisfies OperationalEventRepositoryType)
      ),
      Effect.provide(
        Layer.succeed(PostHogEventService, { capture: () => Effect.void })
      ),
      Effect.provide(
        Layer.succeed(DotyposService, {
          cancelReservation,
        } as unknown as typeof DotyposService.Service)
      ),
      Effect.runPromise
    );

    expect(markTerminalForReservation).not.toHaveBeenCalled();
    expect(claimCancellation).not.toHaveBeenCalled();
    expect(cancelReservation).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceReservationId: orderId,
        paymentAttemptId: attemptId,
        eventType: "workspace_payment_outcome_unconfirmed_before_cleanup",
      })
    );
  });
});
