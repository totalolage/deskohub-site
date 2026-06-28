import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { DatabaseError } from "@/db/database.service";
import type { OperationalEventRepository as OperationalEventRepositoryType } from "@/features/checkout/backend/operational-event.repository";
import type { ProviderPaymentFinalizationService as ProviderPaymentFinalizationServiceType } from "@/features/checkout/backend/provider-payment-finalization.service";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";

describe("ReservationHoldCleanupService", () => {
  test("fails the expired hold sweep when expired hold selection fails", async () => {
    const { OperationalEventRepository } = await import(
      "./operational-event.repository"
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

    const result = await Effect.gen(function* () {
      const cleanup = yield* ReservationHoldCleanupService;
      return yield* cleanup.sweepExpiredHolds({
        now: new Date("2026-06-02T10:00:00.000Z"),
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
    expect(selectExpiredHolds).toHaveBeenCalledWith({
      now: new Date("2026-06-02T10:00:00.000Z"),
      limit: 25,
    });
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
});
