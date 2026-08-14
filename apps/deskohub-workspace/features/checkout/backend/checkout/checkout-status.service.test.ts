import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { SeatingMapFeatureFlagServiceMock } from "@/features/feature-flags/backend/seating-map-feature-flag.service.mock";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "../holds/reservation-hold-cleanup.service";
import type { ProviderPaymentFinalizationService as ProviderPaymentFinalizationServiceType } from "../payment/provider-payment-finalization.service";

const testInstant = (value = "2026-06-01T10:00:00Z") =>
  Temporal.Instant.from(value);

const makeReservation = <Overrides extends object>(overrides?: Overrides) => ({
  id: "reservation-provider-return",
  checkoutSessionKey: "session-key",
  checkoutAttemptKey: "attempt-key",
  correlationId: "correlation-id",
  dotyposCustomerId: "customer-id",
  dotyposReservationId: "dotypos-reservation-id",
  reservationDetails: {
    kind: "cowork",
    entryTier: "profi",
    coffee: true,
    monitorOption: "2x27-qhd",
  },
  productTier: "profi",
  productCoffee: true,
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

const makePaymentAttempt = <Overrides extends object>(
  overrides?: Overrides
) => ({
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

const makeDotypos = <Overrides extends object>(overrides?: Overrides) => ({
  getReservation: mock(() =>
    Effect.succeed({
      reservation: {
        id: "dotypos-reservation-id",
        _customerId: "customer-id",
        startDate: "2026-06-20T00:00:00.000+02:00",
        endDate: "2026-06-21T00:00:00.000+02:00",
        seats: "1",
        status: "CONFIRMED",
      },
      customer: { id: "customer-id" },
    })
  ),
  getTables: mock(() => Effect.succeed([])),
  ...overrides,
});

describe("CheckoutStatusService", () => {
  test("refreshes successful payment status before reading status", async () => {
    const { CheckoutStatusService } = await import("./checkout-status.service");
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
    };
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
    };

    const status = await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.refreshStatus({
        orderId,
        returnOutcome: "success",
      });
    }).pipe(
      Effect.provide(
        CheckoutStatusService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderPaymentFinalizationService, finalization),
              Layer.mock(WorkspaceReservationRepository, reservations),
              Layer.mock(PaymentAttemptRepository, paymentAttempts),
              Layer.mock(DotyposService, makeDotypos()),
              Layer.mock(ReservationHoldCleanupService, holdCleanup),
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
    const { CheckoutStatusService } = await import("./checkout-status.service");
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
    };
    const holdCleanup: ReservationHoldCleanupServiceType = {
      cancelOrderHold,
      sweepExpiredHolds: mock(() =>
        Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
      ),
    };
    const paymentAttempts = {
      findDisplayableForReservation: mock(() => Effect.succeed(null)),
    };

    await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.refreshStatus({
        orderId,
        returnOutcome: "cancelled",
      });
    }).pipe(
      Effect.provide(
        CheckoutStatusService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderPaymentFinalizationService, finalization),
              Layer.mock(WorkspaceReservationRepository, reservations),
              Layer.mock(PaymentAttemptRepository, paymentAttempts),
              Layer.mock(DotyposService, makeDotypos()),
              Layer.mock(ReservationHoldCleanupService, holdCleanup),
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

  test("reconstructs an internal zero-total fulfilled reservation without PII", async () => {
    const { CheckoutStatusService } = await import("./checkout-status.service");
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
    };
    const paymentAttempts = {
      findDisplayableForReservation: mock(() =>
        Effect.succeed(
          makePaymentAttempt({
            provider: "internal",
            providerOrderId: null,
            amount: {
              value: 0,
              exponent: 2,
              currency: "CZK",
            },
          })
        )
      ),
    };
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment: mock(() => Effect.die("not used")),
    };
    const holdCleanup: ReservationHoldCleanupServiceType = {
      cancelOrderHold: mock(() => Effect.die("not used")),
      sweepExpiredHolds: mock(() => Effect.die("not used")),
    };
    let failTableLookup = false;
    const getTables = mock(() =>
      failTableLookup
        ? Effect.fail(new Error("Dotypos table lookup failed"))
        : Effect.succeed([
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
            status: "CONFIRMED",
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
          CheckoutStatusService.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(ProviderPaymentFinalizationService, finalization),
                Layer.mock(WorkspaceReservationRepository, reservations),
                Layer.mock(PaymentAttemptRepository, paymentAttempts),
                Layer.mock(DotyposService, dotypos),
                Layer.mock(ReservationHoldCleanupService, holdCleanup),
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
      kind: "cowork",
      status: "fulfilled",
      summary: {
        kind: "cowork",
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x27-qhd",
        price: { value: 0, exponent: 2, currency: "CZK" },
      },
      tableMap: {
        assignedTableId: "assigned-table",
        roomName: "Main room",
      },
    });
    expect(status.summary?.reservedFrom.toString()).toBe(
      "2026-06-19T22:00:00Z"
    );
    expect(status.summary?.reservedUntil.toString()).toBe(
      "2026-06-20T22:00:00Z"
    );
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

    failTableLookup = true;
    const statusWithoutTables = await loadStatus(true);

    expect(statusWithoutTables.summary).toEqual(status.summary);
    expect(statusWithoutTables.tableMap).toBeUndefined();
    expect(getTables).toHaveBeenCalledTimes(2);
  });

  test("reconstructs meeting-room timing from Dotypos", async () => {
    const { CheckoutStatusService } = await import("./checkout-status.service");
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
            reservationDetails: { kind: "meeting-room" },
            productTier: null,
            productCoffee: false,
            productMonitorOption: null,
            paymentState: "paid",
            fulfillmentState: "fulfilled",
          })
        )
      ),
    };
    const paymentAttempts = {
      findDisplayableForReservation: mock(() =>
        Effect.succeed(makePaymentAttempt())
      ),
    };
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment: mock(() => Effect.die("not used")),
    };
    const holdCleanup: ReservationHoldCleanupServiceType = {
      cancelOrderHold: mock(() => Effect.die("not used")),
      sweepExpiredHolds: mock(() => Effect.die("not used")),
    };
    const dotypos = makeDotypos({
      getReservation: mock(() =>
        Effect.succeed({
          reservation: {
            id: "dotypos-reservation-id",
            _customerId: "customer-id",
            _tableId: "meeting-room-table",
            startDate: "2026-06-20T07:00:00.000Z",
            endDate: "2026-06-20T11:00:00.000Z",
            seats: "12",
            status: "CONFIRMED",
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
            id: "meeting-room-table",
            name: "Meeting room",
            locationName: "Meeting room",
            tags: ["reservation:meeting-room"],
          },
        ])
      ),
    });

    const status = await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.getStatus({
        orderId: "reservation-provider-return",
        returnOutcome: "success",
      });
    }).pipe(
      Effect.provide(
        CheckoutStatusService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderPaymentFinalizationService, finalization),
              Layer.mock(WorkspaceReservationRepository, reservations),
              Layer.mock(PaymentAttemptRepository, paymentAttempts),
              Layer.mock(DotyposService, dotypos),
              Layer.mock(ReservationHoldCleanupService, holdCleanup),
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
      kind: "meeting-room",
      status: "fulfilled",
      summary: {
        kind: "meeting-room",
        price: { value: 55_000, exponent: 2, currency: "CZK" },
      },
      tableMap: {
        assignedTableId: "meeting-room-table",
        roomName: "Meeting room",
      },
    });
    expect(status.summary?.reservedFrom.toString()).toBe(
      "2026-06-20T07:00:00Z"
    );
    expect(status.summary?.reservedUntil.toString()).toBe(
      "2026-06-20T11:00:00Z"
    );
    expect(JSON.stringify(status)).not.toContain("customer-access-code");
  });

  test("reconstructs office dates and seats from Dotypos", async () => {
    const { CheckoutStatusService } = await import("./checkout-status.service");
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
            reservationDetails: { kind: "office" },
            productTier: null,
            productCoffee: false,
            productMonitorOption: null,
            paymentState: "paid",
            fulfillmentState: "fulfilled",
          })
        )
      ),
    };
    const paymentAttempts = {
      findDisplayableForReservation: mock(() =>
        Effect.succeed(makePaymentAttempt())
      ),
    };
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment: mock(() => Effect.die("not used")),
    };
    const holdCleanup: ReservationHoldCleanupServiceType = {
      cancelOrderHold: mock(() => Effect.die("not used")),
      sweepExpiredHolds: mock(() => Effect.die("not used")),
    };
    const dotypos = makeDotypos({
      getReservation: mock(() =>
        Effect.succeed({
          reservation: {
            id: "dotypos-reservation-id",
            _customerId: "customer-id",
            _tableId: "office-table",
            startDate: "2026-06-11T22:00:00.000Z",
            endDate: "2026-06-14T22:00:00.000Z",
            seats: "3",
            status: "CONFIRMED",
          },
          customer: { id: "customer-id" },
        })
      ),
    });

    const status = await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.getStatus({
        orderId: "reservation-provider-return",
        returnOutcome: "success",
      });
    }).pipe(
      Effect.provide(
        CheckoutStatusService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderPaymentFinalizationService, finalization),
              Layer.mock(WorkspaceReservationRepository, reservations),
              Layer.mock(PaymentAttemptRepository, paymentAttempts),
              Layer.mock(DotyposService, dotypos),
              Layer.mock(ReservationHoldCleanupService, holdCleanup),
              SeatingMapFeatureFlagServiceMock({
                isEnabled: Effect.succeed(false),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(status).toMatchObject({
      kind: "office",
      status: "fulfilled",
      summary: {
        kind: "office",
        seats: 3,
        price: { value: 55_000, exponent: 2, currency: "CZK" },
      },
    });
    expect(status.summary?.reservedFrom.toString()).toBe(
      "2026-06-11T22:00:00Z"
    );
    expect(status.summary?.reservedUntil.toString()).toBe(
      "2026-06-14T22:00:00Z"
    );
  });

  test("includes support contact prefill only after fulfillment fails", async () => {
    const { CheckoutStatusService } = await import("./checkout-status.service");
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
    };
    const paymentAttempts = {
      findDisplayableForReservation: mock(() =>
        Effect.succeed(makePaymentAttempt())
      ),
    };
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
        CheckoutStatusService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderPaymentFinalizationService, finalization),
              Layer.mock(WorkspaceReservationRepository, reservations),
              Layer.mock(PaymentAttemptRepository, paymentAttempts),
              Layer.mock(
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
                        status: "CONFIRMED",
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
              Layer.mock(ReservationHoldCleanupService, holdCleanup),
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
    const { CheckoutStatusService } = await import("./checkout-status.service");
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
    };
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
    };
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
        CheckoutStatusService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderPaymentFinalizationService, finalization),
              Layer.mock(WorkspaceReservationRepository, reservations),
              Layer.mock(PaymentAttemptRepository, paymentAttempts),
              Layer.mock(DotyposService, makeDotypos({ getReservation })),
              Layer.mock(ReservationHoldCleanupService, holdCleanup),
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
    const { CheckoutStatusService } = await import("./checkout-status.service");
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
    };
    const paymentAttempts = {
      findDisplayableForReservation: mock(() =>
        Effect.succeed(makePaymentAttempt())
      ),
    };
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
        CheckoutStatusService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderPaymentFinalizationService, finalization),
              Layer.mock(WorkspaceReservationRepository, reservations),
              Layer.mock(PaymentAttemptRepository, paymentAttempts),
              Layer.mock(
                DotyposService,
                makeDotypos({
                  getReservation: mock(() => Effect.fail("down")),
                })
              ),
              Layer.mock(ReservationHoldCleanupService, holdCleanup),
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
