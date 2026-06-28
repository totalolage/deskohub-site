import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "@/features/checkout/backend/payment-attempt.repository";
import type { ProviderPaymentFinalizationService as ProviderPaymentFinalizationServiceType } from "@/features/checkout/backend/provider-payment-finalization.service";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "@/features/checkout/backend/reservation-hold-cleanup.service";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";

const makeReservation = (overrides: Record<string, unknown> = {}) => ({
  id: "reservation-provider-return",
  reservationIntentKey: "intent-key",
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

const makePaymentAttempt = (overrides: Record<string, unknown> = {}) => ({
  id: "attempt-provider-return",
  workspaceReservationId: "reservation-provider-return",
  provider: "nexi",
  providerOrderId: "provider-order-id",
  securityToken: null,
  state: "paid",
  amountValue: 55_000,
  amountExponent: 2,
  currency: "CZK",
  providerRedirectUrl: null,
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeDotypos = (overrides: Record<string, unknown> = {}) =>
  ({
    getReservation: mock(() =>
      Effect.succeed({
        reservation: {
          id: "dotypos-reservation-id",
          _customerId: "customer-id",
          startDate: "2026-06-20T00:00:00.000+02:00",
          endDate: "2026-06-21T00:00:00.000+02:00",
          seats: "1",
          status: "OPEN",
        },
        customer: { id: "customer-id" },
      })
    ),
    getTables: mock(() => Effect.succeed([])),
    ...overrides,
  }) as unknown as typeof DotyposService.Service;

describe("CheckoutStatusService", () => {
  test("refreshes successful payment status before reading status", async () => {
    const { CheckoutStatusService, CheckoutStatusServiceLive } = await import(
      "./checkout-status.service"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "./provider-payment-finalization.service"
    );
    const { PaymentAttemptRepository } = await import(
      "./payment-attempt.repository"
    );
    const { ReservationHoldCleanupService } = await import(
      "./reservation-hold-cleanup.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
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
      cancelOrderHold: mock(() => Effect.succeed("cancelled" as const)),
      sweepExpiredHolds: mock(() =>
        Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
      ),
    };
    const paymentAttempts = {
      findDisplayableForReservation: mock(() => Effect.succeed(null)),
    } as unknown as PaymentAttemptRepositoryType;

    const status = await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.refreshStatus({
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
      Effect.provide(Layer.succeed(PaymentAttemptRepository, paymentAttempts)),
      Effect.provide(Layer.succeed(DotyposService, makeDotypos())),
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

  test("cancels the hold after refresh finds terminal payment", async () => {
    const { CheckoutStatusService, CheckoutStatusServiceLive } = await import(
      "./checkout-status.service"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "./provider-payment-finalization.service"
    );
    const { PaymentAttemptRepository } = await import(
      "./payment-attempt.repository"
    );
    const { ReservationHoldCleanupService } = await import(
      "./reservation-hold-cleanup.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );

    const orderId = "reservation-provider-return";
    const cancelOrderHold = mock(() => Effect.succeed("cancelled" as const));
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment: mock(() => Effect.succeed("terminal")),
    };
    const reservations = {
      findById: mock(() => Effect.succeed(makeReservation())),
    } as unknown as WorkspaceReservationRepositoryType;
    const holdCleanup: ReservationHoldCleanupServiceType = {
      cancelOrderHold,
      sweepExpiredHolds: mock(() =>
        Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
      ),
    };
    const paymentAttempts = {
      findDisplayableForReservation: mock(() => Effect.succeed(null)),
    } as unknown as PaymentAttemptRepositoryType;

    await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.refreshStatus({
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
      Effect.provide(Layer.succeed(PaymentAttemptRepository, paymentAttempts)),
      Effect.provide(Layer.succeed(DotyposService, makeDotypos())),
      Effect.provide(Layer.succeed(ReservationHoldCleanupService, holdCleanup)),
      Effect.runPromise
    );

    expect(cancelOrderHold).toHaveBeenCalledWith({ orderId });
  });

  test("reconstructs a paid fulfilled reservation summary without PII", async () => {
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
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PaymentAttemptRepository } = await import(
      "./payment-attempt.repository"
    );

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
    const paymentAttempts = {
      findDisplayableForReservation: mock(() =>
        Effect.succeed(makePaymentAttempt())
      ),
    } as unknown as PaymentAttemptRepositoryType;
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment: mock(() => Effect.die("not used")),
    };
    const holdCleanup: ReservationHoldCleanupServiceType = {
      cancelOrderHold: mock(() => Effect.die("not used")),
      sweepExpiredHolds: mock(() => Effect.die("not used")),
    };

    const status = await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.getStatus({
        orderId: "reservation-provider-return",
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
      Effect.provide(Layer.succeed(PaymentAttemptRepository, paymentAttempts)),
      Effect.provide(
        Layer.succeed(
          DotyposService,
          makeDotypos({
            getReservation: mock(() =>
              Effect.succeed({
                reservation: {
                  id: "dotypos-reservation-id",
                  _customerId: "customer-id",
                  _tableId: "assigned-table",
                  startDate: "2026-06-19T22:00:00.000Z",
                  endDate: "2026-06-20T22:00:00.000Z",
                  seats: "1",
                  status: "OPEN",
                },
                customer: { id: "customer-id" },
              })
            ),
            getTables: mock(() =>
              Effect.succeed([
                {
                  _cloudId: "cloud-id",
                  display: true,
                  enabled: true,
                  id: "assigned-table",
                  name: "Desk 1",
                  locationName: "Main room",
                  tags: ["tier:profi"],
                },
                {
                  _cloudId: "cloud-id",
                  display: true,
                  enabled: true,
                  id: "neighbor-table",
                  name: "Desk 2",
                  locationName: "Main room",
                  tags: ["tier:profi"],
                },
                {
                  _cloudId: "cloud-id",
                  display: true,
                  enabled: true,
                  id: "other-room-table",
                  name: "Desk 3",
                  locationName: "Quiet room",
                  tags: ["tier:profi"],
                },
              ])
            ),
          })
        )
      ),
      Effect.provide(Layer.succeed(ReservationHoldCleanupService, holdCleanup)),
      Effect.runPromise
    );

    expect(status).toMatchObject({
      status: "fulfilled",
      summary: {
        tier: "profi",
        date: "2026-06-20",
        coffee: false,
        monitorOption: "2x27-qhd",
        price: { value: 55_000, exponent: 2, currency: "CZK" },
      },
      tableMap: {
        assignedTableId: "assigned-table",
        roomName: "Main room",
      },
    });
    expect(status.tableMap?.tables.map((table) => table.id)).toEqual([
      "assigned-table",
      "neighbor-table",
    ]);
    expect(JSON.stringify(status)).not.toContain("email");
    expect(JSON.stringify(status)).not.toContain("phone");
    expect(JSON.stringify(status)).not.toContain("message");
    expect(paymentAttempts.findDisplayableForReservation).toHaveBeenCalledWith({
      workspaceReservationId: "reservation-provider-return",
      activePaymentAttemptId: "attempt-provider-return",
      paymentState: "paid",
    });
  });

  test("includes support contact prefill only after fulfillment fails", async () => {
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
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PaymentAttemptRepository } = await import(
      "./payment-attempt.repository"
    );

    const reservations = {
      findById: mock(() =>
        Effect.succeed(
          makeReservation({
            paymentState: "paid",
            fulfillmentState: "failed",
            fulfillmentFailedAt: new Date("2026-06-20T10:00:00.000Z"),
            fulfillmentFailureCode: "fulfillment_email_failed",
          })
        )
      ),
    } as unknown as WorkspaceReservationRepositoryType;
    const paymentAttempts = {
      findDisplayableForReservation: mock(() =>
        Effect.succeed(makePaymentAttempt())
      ),
    } as unknown as PaymentAttemptRepositoryType;
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment: mock(() => Effect.die("not used")),
    };
    const holdCleanup: ReservationHoldCleanupServiceType = {
      cancelOrderHold: mock(() => Effect.die("not used")),
      sweepExpiredHolds: mock(() => Effect.die("not used")),
    };

    const status = await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.getStatus({
        orderId: "reservation-provider-return",
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
      Effect.provide(Layer.succeed(PaymentAttemptRepository, paymentAttempts)),
      Effect.provide(
        Layer.succeed(
          DotyposService,
          makeDotypos({
            getReservation: mock(() =>
              Effect.succeed({
                reservation: {
                  id: "dotypos-reservation-id",
                  _customerId: "customer-id",
                  startDate: "2026-06-19T22:00:00.000Z",
                  endDate: "2026-06-20T22:00:00.000Z",
                  seats: "1",
                  status: "OPEN",
                },
                customer: {
                  id: "customer-id",
                  firstName: "Ada",
                  lastName: "Lovelace",
                  email: "ada@example.com",
                  phone: "+420777777777",
                },
              })
            ),
          })
        )
      ),
      Effect.provide(Layer.succeed(ReservationHoldCleanupService, holdCleanup)),
      Effect.runPromise
    );

    expect(status).toMatchObject({
      status: "fulfillment_failed",
      supportContactPrefill: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+420777777777",
      },
    });
  });

  test("omits summary when only a failed payment attempt is available", async () => {
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
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PaymentAttemptRepository } = await import(
      "./payment-attempt.repository"
    );

    const reservations = {
      findById: mock(() =>
        Effect.succeed(
          makeReservation({
            paymentState: "failed",
          })
        )
      ),
    } as unknown as WorkspaceReservationRepositoryType;
    const paymentAttempts = {
      findDisplayableForReservation: mock(() =>
        Effect.succeed(
          makePaymentAttempt({
            state: "failed",
            amountValue: 99_999,
          })
        )
      ),
    } as unknown as PaymentAttemptRepositoryType;
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment: mock(() => Effect.die("not used")),
    };
    const holdCleanup: ReservationHoldCleanupServiceType = {
      cancelOrderHold: mock(() => Effect.die("not used")),
      sweepExpiredHolds: mock(() => Effect.die("not used")),
    };
    const getReservation = mock(() => Effect.die("not used"));

    const status = await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.getStatus({
        orderId: "reservation-provider-return",
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
      Effect.provide(Layer.succeed(PaymentAttemptRepository, paymentAttempts)),
      Effect.provide(
        Layer.succeed(DotyposService, makeDotypos({ getReservation }))
      ),
      Effect.provide(Layer.succeed(ReservationHoldCleanupService, holdCleanup)),
      Effect.runPromise
    );

    expect(status.status).toBe("payment_failed");
    expect(status.summary).toBeUndefined();
    expect(getReservation).not.toHaveBeenCalled();
  });

  test("keeps status renderable when Dotypos summary lookup fails", async () => {
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
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PaymentAttemptRepository } = await import(
      "./payment-attempt.repository"
    );

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
    const paymentAttempts = {
      findDisplayableForReservation: mock(() =>
        Effect.succeed(makePaymentAttempt())
      ),
    } as unknown as PaymentAttemptRepositoryType;
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment: mock(() => Effect.die("not used")),
    };
    const holdCleanup: ReservationHoldCleanupServiceType = {
      cancelOrderHold: mock(() => Effect.die("not used")),
      sweepExpiredHolds: mock(() => Effect.die("not used")),
    };

    const status = await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.getStatus({
        orderId: "reservation-provider-return",
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
      Effect.provide(Layer.succeed(PaymentAttemptRepository, paymentAttempts)),
      Effect.provide(
        Layer.succeed(
          DotyposService,
          makeDotypos({ getReservation: mock(() => Effect.fail("down")) })
        )
      ),
      Effect.provide(Layer.succeed(ReservationHoldCleanupService, holdCleanup)),
      Effect.runPromise
    );

    expect(status.status).toBe("fulfilled");
    expect(status.summary).toBeUndefined();
  });
});
