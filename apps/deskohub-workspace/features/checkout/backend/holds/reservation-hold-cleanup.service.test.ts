import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer } from "effect";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import type { ProviderPaymentFinalizationService as ProviderPaymentFinalizationServiceType } from "../payment/provider-payment-finalization.service";
import type { IPaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";

describe("ReservationHoldCleanupService", () => {
  test("fails the expired hold sweep when expired hold selection fails", async () => {
    const { PaymentLifecycleRepository } = await import(
      "../repositories/payment-lifecycle.repository"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
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
        new EffectDrizzleQueryError({
          query: "select expired holds",
          params: [],
          cause: "down",
        })
      )
    );
    const reservations = {
      selectExpiredHolds,
    } as unknown as WorkspaceReservationRepositoryType;
    const dotypos = {} as unknown as typeof DotyposService.Service;

    const now = Temporal.Instant.from("2026-06-02T10:00:00.000Z");
    const result = await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.sweepExpiredHolds({
        now,
        limit: 25,
      });
    }).pipe(
      Effect.provide(
        ReservationHoldCleanupServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ProviderPaymentFinalizationService, {
                finalizePendingProviderPayment: unused,
              } satisfies ProviderPaymentFinalizationServiceType),
              Layer.succeed(PaymentLifecycleRepository, {
                markTerminal: unused,
              } as unknown as IPaymentLifecycleRepository),
              Layer.succeed(WorkspaceReservationRepository, reservations),
              Layer.succeed(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.succeed(DotyposService, dotypos)
            )
          )
        )
      ),
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
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { PaymentLifecycleRepository } = await import(
      "../repositories/payment-lifecycle.repository"
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
    } as unknown as WorkspaceReservationRepositoryType;
    const dotypos = {
      cancelReservation,
    } as unknown as typeof DotyposService.Service;

    const outcome = await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.cancelOrderHold({
        orderId,
        holdExpiredAt: Temporal.Instant.from("2026-06-02T10:00:00.000Z"),
      });
    }).pipe(
      Effect.provide(
        ReservationHoldCleanupServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ProviderPaymentFinalizationService, finalization),
              Layer.succeed(PaymentLifecycleRepository, {
                markTerminal: mock(() => Effect.die("not used")),
              } as unknown as IPaymentLifecycleRepository),
              Layer.succeed(WorkspaceReservationRepository, reservations),
              Layer.succeed(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.succeed(DotyposService, dotypos)
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
    } as unknown as WorkspaceReservationRepositoryType;
    const dotypos = {
      cancelReservation,
    } as unknown as typeof DotyposService.Service;

    const runSweep = () =>
      Effect.gen(function* () {
        const cleanup = yield* ReservationHoldCleanupService;
        return yield* cleanup.sweepExpiredHolds({ now, limit: 1 });
      }).pipe(
        Effect.provide(
          ReservationHoldCleanupServiceLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ProviderPaymentFinalizationService, finalization),
                Layer.succeed(PaymentLifecycleRepository, {
                  markTerminal: mock(() => Effect.die("not used")),
                } as unknown as IPaymentLifecycleRepository),
                Layer.succeed(WorkspaceReservationRepository, reservations),
                Layer.succeed(PostHogEventService, {
                  capture: () => Effect.void,
                }),
                Layer.succeed(DotyposService, dotypos)
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

  test("does not expire or cancel a payment attempt whose remote state is not verifiable", async () => {
    const { PaymentLifecycleRepository } = await import(
      "../repositories/payment-lifecycle.repository"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
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
    const holdExpiredAt = Temporal.Instant.from("2026-06-02T10:00:00.000Z");
    const claimCancellation = mock(() => Effect.succeed(null));
    const cancelReservation = mock(() => Effect.void);
    const markCancelled = mock(() => Effect.void);
    const recordHoldCleanupSkipped = mock(() => Effect.void);
    const markTerminalForReservation = mock(() => Effect.die("not used"));
    await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.cancelOrderHold({ orderId, holdExpiredAt });
    }).pipe(
      Effect.provide(
        ReservationHoldCleanupServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ProviderPaymentFinalizationService, {
                finalizePendingProviderPayment: mock(() =>
                  Effect.succeed("not_verifiable" as const)
                ),
              } satisfies ProviderPaymentFinalizationServiceType),
              Layer.succeed(PaymentLifecycleRepository, {
                markTerminal: markTerminalForReservation,
              } as unknown as IPaymentLifecycleRepository),
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
                recordHoldCleanupSkipped,
              } as unknown as WorkspaceReservationRepositoryType),
              Layer.succeed(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.succeed(DotyposService, {
                cancelReservation,
              } as unknown as typeof DotyposService.Service)
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(markTerminalForReservation).not.toHaveBeenCalled();
    expect(claimCancellation).not.toHaveBeenCalled();
    expect(cancelReservation).not.toHaveBeenCalled();
    expect(markCancelled).not.toHaveBeenCalled();
    expect(recordHoldCleanupSkipped).toHaveBeenCalledWith({
      id: orderId,
      holdExpiredAt,
      failureCode: "payment_outcome_unconfirmed_before_cleanup",
    });
  });

  test("does not enter terminal settlement for a stale unverified attempt", async () => {
    const { PaymentLifecycleRepository } = await import(
      "../repositories/payment-lifecycle.repository"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
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

    await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.cancelOrderHold({ orderId });
    }).pipe(
      Effect.provide(
        ReservationHoldCleanupServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ProviderPaymentFinalizationService, {
                finalizePendingProviderPayment: mock(() =>
                  Effect.succeed("not_verifiable" as const)
                ),
              } satisfies ProviderPaymentFinalizationServiceType),
              Layer.succeed(PaymentLifecycleRepository, {
                markTerminal: mock(() => Effect.die("not used")),
              } as unknown as IPaymentLifecycleRepository),
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
              } as unknown as WorkspaceReservationRepositoryType),
              Layer.succeed(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.succeed(DotyposService, {
                cancelReservation,
              } as unknown as typeof DotyposService.Service)
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(claimCancellation).not.toHaveBeenCalled();
    expect(cancelReservation).not.toHaveBeenCalled();
  });

  test("does not cancel an expired hold when provider verification fails transiently", async () => {
    const { PaymentLifecycleRepository } = await import(
      "../repositories/payment-lifecycle.repository"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
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

    await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.cancelOrderHold({ orderId });
    }).pipe(
      Effect.provide(
        ReservationHoldCleanupServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ProviderPaymentFinalizationService, {
                finalizePendingProviderPayment: mock(() =>
                  Effect.succeed("provider_verification_failed" as const)
                ),
              } satisfies ProviderPaymentFinalizationServiceType),
              Layer.succeed(PaymentLifecycleRepository, {
                markTerminal: markTerminalForReservation,
              } as unknown as IPaymentLifecycleRepository),
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
              } as unknown as WorkspaceReservationRepositoryType),
              Layer.succeed(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.succeed(DotyposService, {
                cancelReservation,
              } as unknown as typeof DotyposService.Service)
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
});
