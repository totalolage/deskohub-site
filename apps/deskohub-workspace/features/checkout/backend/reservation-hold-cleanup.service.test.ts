import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { OperationalEventRepository as OperationalEventRepositoryType } from "@/features/checkout/backend/operational-event.repository";
import type { ProviderPaymentFinalizationService as ProviderPaymentFinalizationServiceType } from "@/features/checkout/backend/provider-payment-finalization.service";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/checkout/backend/workspace-reservation.repository";

describe("ReservationHoldCleanupService", () => {
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
      "./workspace-reservation.repository"
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

    await Effect.gen(function* () {
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
      Effect.provide(Layer.succeed(DotyposService, dotypos)),
      Effect.runPromise
    );

    expect(finalization.finalizePendingProviderPayment).toHaveBeenCalledWith({
      orderId,
      paymentAttemptId: attemptId,
    });
    expect(claimCancellation).not.toHaveBeenCalled();
    expect(cancelReservation).not.toHaveBeenCalled();
  });
});
