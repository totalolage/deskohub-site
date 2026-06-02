import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { ProviderPaymentFinalizationService as ProviderPaymentFinalizationServiceType } from "@/features/checkout/backend/provider-payment-finalization.service";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "@/features/checkout/backend/reservation-hold-cleanup.service";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/checkout/backend/workspace-reservation.repository";

const makeReservation = (overrides: Record<string, unknown> = {}) => ({
  id: "reservation-provider-return",
  reservationSubmitKey: "submit-key",
  correlationId: "correlation-id",
  dotyposCustomerId: "customer-id",
  dotyposReservationId: "dotypos-reservation-id",
  productTier: "profi",
  productCoffee: false,
  productMonitorOption: "2x27-qhd",
  locale: "en-US",
  reservationState: "held",
  reservationHoldExpiresAt: new Date("2099-06-20T10:00:00.000Z"),
  reservationHoldExpiredAt: null,
  reservationCreatedAt: new Date("2026-06-01T10:00:00.000Z"),
  reservationCancelledAt: null,
  paidAt: null,
  fulfillmentState: "not_started",
  fulfilledAt: null,
  fulfillmentFailedAt: null,
  reservationConfirmedAt: null,
  paymentState: "pending",
  activePaymentAttemptId: "attempt-provider-return",
  failureCode: null,
  fulfillmentFailureCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("CheckoutStatusService", () => {
  test("finalizes a successful provider return before reading status", async () => {
    const { CheckoutStatusService, CheckoutStatusServiceLive } = await import(
      "./checkout-status.service"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "./provider-payment-finalization.service"
    );
    const { ReservationHoldCleanupService } = await import(
      "./reservation-hold-cleanup.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "./workspace-reservation.repository"
    );

    const orderId = "reservation-provider-return";
    const finalizePendingProviderPayment = mock(() => Effect.succeed("paid"));
    const reservations = {
      findById: mock(() =>
        Effect.succeed(
          makeReservation({
            paymentState: "paid",
            fulfillmentState: "fulfilled",
          })
        )
      ),
    } as unknown as WorkspaceReservationRepositoryType;
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment,
    };
    const holdCleanup: ReservationHoldCleanupServiceType = {
      cancelOrderHold: mock(() => Effect.void),
      sweepExpiredHolds: mock(() =>
        Effect.succeed({ cancelled: 0, failed: 0 })
      ),
    };

    const status = await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.recordProviderReturn({
        orderId,
        returnOutcome: "success",
      });
    }).pipe(
      Effect.provide(CheckoutStatusServiceLive),
      Effect.provide(
        Layer.succeed(ProviderPaymentFinalizationService, finalization)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceReservationRepository, reservations)
      ),
      Effect.provide(Layer.succeed(ReservationHoldCleanupService, holdCleanup)),
      Effect.runPromise
    );

    expect(finalizePendingProviderPayment).toHaveBeenCalledWith({
      orderId,
      paymentAttemptId: "attempt-provider-return",
    });
    expect(status.status).toBe("fulfilled");
    expect(holdCleanup.cancelOrderHold).not.toHaveBeenCalled();
  });

  test("cancels the hold after provider return finalizes terminal payment", async () => {
    const { CheckoutStatusService, CheckoutStatusServiceLive } = await import(
      "./checkout-status.service"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "./provider-payment-finalization.service"
    );
    const { ReservationHoldCleanupService } = await import(
      "./reservation-hold-cleanup.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "./workspace-reservation.repository"
    );

    const orderId = "reservation-provider-return";
    const cancelOrderHold = mock(() => Effect.void);
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment: mock(() => Effect.succeed("terminal")),
    };
    const reservations = {
      findById: mock(() => Effect.succeed(makeReservation())),
    } as unknown as WorkspaceReservationRepositoryType;
    const holdCleanup: ReservationHoldCleanupServiceType = {
      cancelOrderHold,
      sweepExpiredHolds: mock(() =>
        Effect.succeed({ cancelled: 0, failed: 0 })
      ),
    };

    await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.recordProviderReturn({
        orderId,
        returnOutcome: "cancelled",
      });
    }).pipe(
      Effect.provide(CheckoutStatusServiceLive),
      Effect.provide(
        Layer.succeed(ProviderPaymentFinalizationService, finalization)
      ),
      Effect.provide(
        Layer.succeed(WorkspaceReservationRepository, reservations)
      ),
      Effect.provide(Layer.succeed(ReservationHoldCleanupService, holdCleanup)),
      Effect.runPromise
    );

    expect(cancelOrderHold).toHaveBeenCalledWith({ orderId });
  });
});
