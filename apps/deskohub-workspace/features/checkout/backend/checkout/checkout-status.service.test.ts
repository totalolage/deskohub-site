import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { SeatingMapFeatureFlagServiceMock } from "@/features/feature-flags/backend/seating-map-feature-flag.service.mock";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "../holds/reservation-hold-cleanup.service";
import type { ProviderPaymentFinalizationService as ProviderPaymentFinalizationServiceType } from "../payment/provider-payment-finalization.service";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "../repositories/payment-attempt.repository";

const testInstant = (value = "2026-06-01T10:00:00Z") =>
  Temporal.Instant.from(value);

const makeReservation = (overrides: Record<string, unknown> = {}) => ({
  id: "reservation-provider-return",
  checkoutSessionKey: "session-key",
  checkoutAttemptKey: "attempt-key",
  correlationId: "correlation-id",
  dotyposCustomerId: "customer-id",
  dotyposReservationId: "dotypos-reservation-id",
  productTier: "profi",
  productCoffee: false,
  productMonitorOption: "2x27-qhd",
  locale: "en-US",
  reservationState: "held",
  reservationHoldExpiresAt: testInstant("2099-06-20T10:00:00.000Z"),
  reservationHoldExpiredAt: null,
  reservationCreatedAt: testInstant("2026-06-01T10:00:00.000Z"),
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
  createdAt: testInstant(),
  updatedAt: testInstant(),
  ...overrides,
});

const makePaymentAttempt = (overrides: Record<string, unknown> = {}) => ({
  id: "attempt-provider-return",
  workspaceReservationId: "reservation-provider-return",
  provider: "nexi",
  providerOrderId: "provider-order-id",
  securityToken: null,
  state: "paid",
  amount: {
    value: 55_000,
    exponent: 2,
    currency: "CZK",
  },
  providerRedirectUrl: null,
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  createdAt: testInstant(),
  updatedAt: testInstant(),
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
      "../payment/provider-payment-finalization.service"
    );
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
    );
    const { ReservationHoldCleanupService } = await import(
      "../holds/reservation-hold-cleanup.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );

    const orderId = "reservation-provider-return";
    const finalizePendingProviderPayment = mock(() =>
      Effect.succeed("paid" as const)
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
      Effect.provide(
        CheckoutStatusServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ProviderPaymentFinalizationService, finalization),
              Layer.succeed(WorkspaceReservationRepository, reservations),
              Layer.succeed(PaymentAttemptRepository, paymentAttempts),
              Layer.succeed(DotyposService, makeDotypos()),
              Layer.succeed(ReservationHoldCleanupService, holdCleanup),
              SeatingMapFeatureFlagServiceMock({
                isEnabled: Effect.succeed(true),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(finalizePendingProviderPayment).toHaveBeenCalledWith({
      orderId,
      paymentAttemptId: "attempt-provider-return",
    });
    expect(status.status).toBe("fulfilled");
    expect(holdCleanup.cancelOrderHold).not.toHaveBeenCalled();
  });

  test("does not clean up the hold after refresh finds terminal payment", async () => {
    const { CheckoutStatusService, CheckoutStatusServiceLive } = await import(
      "./checkout-status.service"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
    );
    const { ReservationHoldCleanupService } = await import(
      "../holds/reservation-hold-cleanup.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );

    const orderId = "reservation-provider-return";
    const cancelOrderHold = mock(() => Effect.succeed("cancelled" as const));
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment: mock(() =>
        Effect.succeed("terminal" as const)
      ),
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
      Effect.provide(
        CheckoutStatusServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ProviderPaymentFinalizationService, finalization),
              Layer.succeed(WorkspaceReservationRepository, reservations),
              Layer.succeed(PaymentAttemptRepository, paymentAttempts),
              Layer.succeed(DotyposService, makeDotypos()),
              Layer.succeed(ReservationHoldCleanupService, holdCleanup),
              SeatingMapFeatureFlagServiceMock({
                isEnabled: Effect.succeed(true),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(cancelOrderHold).not.toHaveBeenCalled();
  });

  test("reconstructs a paid fulfilled reservation summary without PII", async () => {
    const { CheckoutStatusService, CheckoutStatusServiceLive } = await import(
      "./checkout-status.service"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { ReservationHoldCleanupService } = await import(
      "../holds/reservation-hold-cleanup.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
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
    const getTables = mock(() =>
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
    );
    const dotypos = makeDotypos({
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
      getTables,
    });

    const loadStatus = (seatingMapEnabled: boolean) =>
      Effect.gen(function* () {
        const service = yield* CheckoutStatusService;
        return yield* service.getStatus({
          orderId: "reservation-provider-return",
          returnOutcome: "success",
        });
      }).pipe(
        Effect.provide(
          CheckoutStatusServiceLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ProviderPaymentFinalizationService, finalization),
                Layer.succeed(WorkspaceReservationRepository, reservations),
                Layer.succeed(PaymentAttemptRepository, paymentAttempts),
                Layer.succeed(DotyposService, dotypos),
                Layer.succeed(ReservationHoldCleanupService, holdCleanup),
                SeatingMapFeatureFlagServiceMock({
                  isEnabled: Effect.succeed(seatingMapEnabled),
                })
              )
            )
          )
        ),
        Effect.runPromise
      );

    const status = await loadStatus(true);

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

    const statusWithoutSeatingMap = await loadStatus(false);

    expect(statusWithoutSeatingMap.summary).toEqual(status.summary);
    expect(statusWithoutSeatingMap.tableMap).toBeUndefined();
    expect(getTables).toHaveBeenCalledTimes(1);
  });

  test("includes support contact prefill only after fulfillment fails", async () => {
    const { CheckoutStatusService, CheckoutStatusServiceLive } = await import(
      "./checkout-status.service"
    );
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { ReservationHoldCleanupService } = await import(
      "../holds/reservation-hold-cleanup.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
    );

    const reservations = {
      findById: mock(() =>
        Effect.succeed(
          makeReservation({
            paymentState: "paid",
            fulfillmentState: "failed",
            fulfillmentFailedAt: testInstant("2026-06-20T10:00:00.000Z"),
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
      Effect.provide(
        CheckoutStatusServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ProviderPaymentFinalizationService, finalization),
              Layer.succeed(WorkspaceReservationRepository, reservations),
              Layer.succeed(PaymentAttemptRepository, paymentAttempts),
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
              ),
              Layer.succeed(ReservationHoldCleanupService, holdCleanup),
              SeatingMapFeatureFlagServiceMock({
                isEnabled: Effect.succeed(true),
              })
            )
          )
        )
      ),
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
      "../payment/provider-payment-finalization.service"
    );
    const { ReservationHoldCleanupService } = await import(
      "../holds/reservation-hold-cleanup.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
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
            amount: {
              value: 99_999,
              exponent: 2,
              currency: "CZK",
            },
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
      Effect.provide(
        CheckoutStatusServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ProviderPaymentFinalizationService, finalization),
              Layer.succeed(WorkspaceReservationRepository, reservations),
              Layer.succeed(PaymentAttemptRepository, paymentAttempts),
              Layer.succeed(DotyposService, makeDotypos({ getReservation })),
              Layer.succeed(ReservationHoldCleanupService, holdCleanup),
              SeatingMapFeatureFlagServiceMock({
                isEnabled: Effect.succeed(true),
              })
            )
          )
        )
      ),
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
      "../payment/provider-payment-finalization.service"
    );
    const { ReservationHoldCleanupService } = await import(
      "../holds/reservation-hold-cleanup.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
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
      Effect.provide(
        CheckoutStatusServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ProviderPaymentFinalizationService, finalization),
              Layer.succeed(WorkspaceReservationRepository, reservations),
              Layer.succeed(PaymentAttemptRepository, paymentAttempts),
              Layer.succeed(
                DotyposService,
                makeDotypos({
                  getReservation: mock(() => Effect.fail("down")),
                })
              ),
              Layer.succeed(ReservationHoldCleanupService, holdCleanup),
              SeatingMapFeatureFlagServiceMock({
                isEnabled: Effect.succeed(true),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(status.status).toBe("fulfilled");
    expect(status.summary).toBeUndefined();
  });
});
