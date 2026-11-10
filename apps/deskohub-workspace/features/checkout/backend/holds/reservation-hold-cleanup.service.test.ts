import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService, DotyposUnavailable } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { ProviderPaymentFinalizationService as ProviderPaymentFinalizationServiceType } from "../payment/provider-payment-finalization.service";

describe("ReservationHoldCleanupService", () => {
  test("does not cancel an expired hold when the pending provider payment finalizes paid", async () => {
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { PaymentLifecycleRepository } = await import(
      "../repositories/payment-lifecycle.repository"
    );
    const { ReservationHoldCleanupService } = await import(
      "./reservation-hold-cleanup.service"
    );
    const { UnpaidHoldRelease } = await import("./unpaid-hold-release.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { recordCheckoutAnalytics } = await import(
      "@/features/checkout/backend/analytics/checkout-analytics.service.mock"
    );

    const orderId = "reservation-cleanup-provider-paid";
    const attemptId = "attempt-cleanup-provider-paid";
    const cancelReservation = mock(() => Effect.void);
    const claimCancellation = mock(() => Effect.succeed(null));
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment: mock(() =>
        Effect.succeed("paid" as const)
      ),
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
    };
    const dotypos = {
      cancelReservation,
    };

    const outcome = await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.cancelOrderHold({
        orderId,
        checkedAt: Temporal.Instant.from("2026-06-02T10:00:00.000Z"),
      });
    }).pipe(
      Effect.provide(
        ReservationHoldCleanupService.Default.pipe(
          Layer.provide(UnpaidHoldRelease.Default),
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderPaymentFinalizationService, finalization),
              Layer.mock(PaymentLifecycleRepository, {
                markTerminal: mock(() => Effect.die("not used")),
              }),
              Layer.mock(WorkspaceReservationRepository, reservations),
              recordCheckoutAnalytics().layer,
              Layer.mock(DotyposService, dotypos)
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(outcome).toBe("skipped");
    expect(finalization.finalizePendingProviderPayment).toHaveBeenCalledWith({
      orderId,
      paymentAttemptId: attemptId,
      abandonmentCheckedAt: Temporal.Instant.from("2026-06-02T10:00:00.000Z"),
    });
    expect(claimCancellation).not.toHaveBeenCalled();
    expect(cancelReservation).not.toHaveBeenCalled();
  });

  test("counts unconfirmed pending payment cleanup as skipped without cancelling", async () => {
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { PaymentLifecycleRepository } = await import(
      "../repositories/payment-lifecycle.repository"
    );
    const { ReservationHoldCleanupService } = await import(
      "./reservation-hold-cleanup.service"
    );
    const { UnpaidHoldRelease } = await import("./unpaid-hold-release.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { recordCheckoutAnalytics } = await import(
      "@/features/checkout/backend/analytics/checkout-analytics.service.mock"
    );

    const orderId = "reservation-cleanup-provider-pending";
    const attemptId = "attempt-cleanup-provider-pending";
    const now = Temporal.Instant.from("2026-06-02T10:00:00.000Z");
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
    };
    const dotypos = {
      cancelReservation,
    };

    const runSweep = () =>
      Effect.gen(function* () {
        const cleanup = yield* ReservationHoldCleanupService;
        return yield* cleanup.sweepExpiredHolds({ now, limit: 1 });
      }).pipe(
        Effect.provide(
          ReservationHoldCleanupService.Default.pipe(
            Layer.provide(UnpaidHoldRelease.Default),
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(ProviderPaymentFinalizationService, finalization),
                Layer.mock(PaymentLifecycleRepository, {
                  markTerminal: mock(() => Effect.die("not used")),
                }),
                Layer.mock(WorkspaceReservationRepository, reservations),
                recordCheckoutAnalytics().layer,
                Layer.mock(DotyposService, dotypos)
              )
            )
          )
        ),
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

  test("expires a verified abandoned payment attempt before cancelling the hold", async () => {
    const { PaymentLifecycleRepository } = await import(
      "../repositories/payment-lifecycle.repository"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { ReservationHoldCleanupService } = await import(
      "./reservation-hold-cleanup.service"
    );
    const { UnpaidHoldRelease } = await import("./unpaid-hold-release.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { recordCheckoutAnalytics } = await import(
      "@/features/checkout/backend/analytics/checkout-analytics.service.mock"
    );

    const orderId = "reservation-cleanup-abandoned";
    const attemptId = "attempt-cleanup-abandoned";
    const checkedAt = Temporal.Instant.from("2026-06-02T10:00:00.000Z");
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
        timestamp: Temporal.Now.instant(),
      })
    );
    const analytics = recordCheckoutAnalytics();
    await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.cancelOrderHold({ orderId, checkedAt });
    }).pipe(
      Effect.provide(
        ReservationHoldCleanupService.Default.pipe(
          Layer.provide(UnpaidHoldRelease.Default),
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderPaymentFinalizationService, {
                finalizePendingProviderPayment: mock(() =>
                  Effect.succeed("abandoned" as const)
                ),
              } satisfies ProviderPaymentFinalizationServiceType),
              Layer.mock(PaymentLifecycleRepository, {
                markTerminal: markTerminalForReservation,
              }),
              Layer.mock(WorkspaceReservationRepository, {
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
              }),
              analytics.layer,
              Layer.mock(DotyposService, {
                getReservationStatus: mock(() =>
                  Effect.succeed("NEW" as const)
                ),
                cancelReservation,
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(markTerminalForReservation).toHaveBeenCalledWith({
      id: attemptId,
      workspaceReservationId: orderId,
      state: "expired",
      failureCode: "payment_abandoned_after_provider_cutoff",
    });

    expect(claimCancellation).toHaveBeenCalledWith(orderId);
    expect(cancelReservation).toHaveBeenCalledWith("dotypos-reservation-id");
    expect(markCancelled).toHaveBeenCalledWith({
      id: orderId,
      cancelledAt: expect.any(Temporal.Instant),
      holdExpiredAt: checkedAt,
    });
    expect(analytics.messages).toContainEqual(
      expect.objectContaining({
        distinctId: orderId,
        event: "reservation abandoned",
      })
    );
  });

  test("does not cancel an expired hold when provider verification fails transiently", async () => {
    const { PaymentLifecycleRepository } = await import(
      "../repositories/payment-lifecycle.repository"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { ReservationHoldCleanupService } = await import(
      "./reservation-hold-cleanup.service"
    );
    const { UnpaidHoldRelease } = await import("./unpaid-hold-release.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { recordCheckoutAnalytics } = await import(
      "@/features/checkout/backend/analytics/checkout-analytics.service.mock"
    );

    const orderId = "reservation-cleanup-provider-failed";
    const attemptId = "attempt-cleanup-provider-failed";
    const markTerminalForReservation = mock(() => Effect.die("not used"));
    const claimCancellation = mock(() => Effect.succeed(null));
    const cancelReservation = mock(() => Effect.void);

    await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.cancelOrderHold({ orderId });
    }).pipe(
      Effect.provide(
        ReservationHoldCleanupService.Default.pipe(
          Layer.provide(UnpaidHoldRelease.Default),
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderPaymentFinalizationService, {
                finalizePendingProviderPayment: mock(() =>
                  Effect.succeed("provider_verification_failed" as const)
                ),
              } satisfies ProviderPaymentFinalizationServiceType),
              Layer.mock(PaymentLifecycleRepository, {
                markTerminal: markTerminalForReservation,
              }),
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() =>
                  Effect.succeed({
                    id: orderId,
                    reservationState: "held",
                    paymentState: "pending",
                    activePaymentAttemptId: attemptId,
                  })
                ),
                claimCancellation,
              }),
              recordCheckoutAnalytics().layer,
              Layer.mock(DotyposService, {
                cancelReservation,
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(markTerminalForReservation).not.toHaveBeenCalled();
    expect(claimCancellation).not.toHaveBeenCalled();
    expect(cancelReservation).not.toHaveBeenCalled();
  });

  test("sweeps expired holds under their live Dotypos status", async () => {
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { PaymentLifecycleRepository } = await import(
      "../repositories/payment-lifecycle.repository"
    );
    const { ReservationHoldCleanupService } = await import(
      "./reservation-hold-cleanup.service"
    );
    const { UnpaidHoldRelease } = await import("./unpaid-hold-release.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { recordCheckoutAnalytics } = await import(
      "@/features/checkout/backend/analytics/checkout-analytics.service.mock"
    );

    // One expired hold per live Dotypos status, and one whose status can't
    // be read. None has a pending payment, so each goes straight to release.
    const statuses = {
      "reservation-sweep-new": "NEW",
      "reservation-sweep-cancelled": "CANCELLED",
      "reservation-sweep-confirmed": "CONFIRMED",
      "reservation-sweep-unreadable": undefined,
    } as const;
    type OrderId = keyof typeof statuses;
    const orderIds = Object.keys(statuses) as OrderId[];
    const holdOf = (id: OrderId) => `dotypos-${id}`;
    const orderOf = (id: OrderId) => ({
      id,
      reservationState: "held",
      paymentState: "not_started",
      activePaymentAttemptId: null,
      dotyposReservationId: holdOf(id),
      dotyposCustomerId: "dotypos-customer-id",
    });
    const orderIdOfHold = (hold: string) =>
      orderIds.find((id) => holdOf(id) === hold)!;

    const markCancelled = mock((_: { readonly id: string }) => Effect.void);
    const markCancellationFailed = mock(
      (_: { readonly id: string; readonly failureCode: string }) => Effect.void
    );
    const cancelReservation = mock((_: string) => Effect.void);
    const getReservationStatus = mock((hold: string) => {
      const status = statuses[orderIdOfHold(hold)];
      return status
        ? Effect.succeed(status)
        : Effect.fail(
            new DotyposUnavailable({
              operation: "getReservationStatus",
              reason: "server",
            })
          );
    });
    const analytics = recordCheckoutAnalytics();

    const summary = await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.sweepExpiredHolds({
        now: Temporal.Instant.from("2026-06-02T10:00:00.000Z"),
        limit: orderIds.length,
      });
    }).pipe(
      Effect.provide(
        ReservationHoldCleanupService.Default.pipe(
          Layer.provide(UnpaidHoldRelease.Default),
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderPaymentFinalizationService, {
                finalizePendingProviderPayment: mock(() =>
                  Effect.die("not used")
                ),
              } satisfies ProviderPaymentFinalizationServiceType),
              Layer.mock(PaymentLifecycleRepository, {
                markTerminal: mock(() => Effect.die("not used")),
              }),
              Layer.mock(WorkspaceReservationRepository, {
                selectExpiredHolds: mock(() =>
                  Effect.succeed(orderIds.map(orderOf) as never)
                ),
                findById: mock((id: string) =>
                  Effect.succeed(orderOf(id as OrderId) as never)
                ),
                claimCancellation: mock((id: string) =>
                  Effect.succeed({
                    ...orderOf(id as OrderId),
                    reservationState: "cancelling",
                  } as never)
                ),
                markCancelled,
                markCancellationFailed,
              }),
              analytics.layer,
              Layer.mock(DotyposService, {
                getReservationStatus,
                cancelReservation,
              } as never)
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(summary).toEqual({ cancelled: 2, skipped: 1, failed: 1 });
    expect(getReservationStatus).toHaveBeenCalledTimes(orderIds.length);
    expect(cancelReservation.mock.calls).toEqual([
      [holdOf("reservation-sweep-new")],
    ]);
    expect(markCancelled.mock.calls.map(([marker]) => marker.id)).toEqual([
      "reservation-sweep-new",
      "reservation-sweep-cancelled",
    ]);
    expect(markCancellationFailed.mock.calls.map(([marker]) => marker)).toEqual(
      [
        {
          id: "reservation-sweep-confirmed",
          failureCode: "dotypos_cancel_failed",
        },
        {
          id: "reservation-sweep-unreadable",
          failureCode: "dotypos_cancel_failed",
        },
      ]
    );
    expect(
      analytics.messages
        .filter(({ event }) => event === "reservation abandoned")
        .map(({ distinctId }) => distinctId)
    ).toEqual(["reservation-sweep-new", "reservation-sweep-cancelled"]);
  });
});
