import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Duration, Effect, Fiber, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { SeatingMapFeatureFlagServiceMock } from "@/features/feature-flags/backend/seating-map-feature-flag.service.mock";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { ReservationRecords } from "@/features/reservation/backend/reservation-records";
import { ReviewSandboxMock } from "@/features/review-accounts/backend/review-sandbox.service.mock";
import { LatePaymentVerificationService } from "../payment/late-payment-verification.service";
import type { ProviderPaymentFinalizationService as ProviderPaymentFinalizationServiceType } from "../payment/provider-payment-finalization.service";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";

const reviewSandboxLayer = ReviewSandboxMock({
  status: () => Effect.succeed(Option.none()),
  isOrderOf: () => Effect.succeed(false),
});

/** These checkouts never received a late payment. */
const noLatePaymentLayer = () =>
  Layer.mergeAll(
    Layer.mock(LatePaymentRecoveryRepository, {
      findLatestByWorkspaceReservationId: mock(() => Effect.succeed(null)),
    }),
    Layer.mock(LatePaymentVerificationService, {
      startRecoveryIfSettled: mock(() =>
        Effect.succeed("not_applicable" as const)
      ),
    })
  );

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
  getReservationWithoutCustomer: mock(() =>
    Effect.succeed({
      id: "dotypos-reservation-id",
      _customerId: "customer-id",
      startDate: "2026-06-20T00:00:00.000+02:00",
      endDate: "2026-06-21T00:00:00.000+02:00",
      seats: "1",
      status: "CONFIRMED",
    })
  ),
  getCustomer: mock(() => Effect.succeed({ id: "customer-id" })),
  getTables: mock(() => Effect.succeed([])),
  ...overrides,
});

/** Serves the status page's table inventory from the mocked Dotypos tables. */
const dotyposLayer = (dotypos: ReturnType<typeof makeDotypos>) =>
  Layer.mergeAll(
    ReservationRecords.Provider.pipe(
      Layer.provideMerge(Layer.mock(DotyposService, dotypos))
    ),
    Layer.mock(AdvisoryAvailabilityInventory, {
      tables: Effect.suspend(() => dotypos.getTables()),
    })
  );

describe("CheckoutStatusService", () => {
  test("refreshes successful payment status before reading status", async () => {
    const { CheckoutStatusService } = await import("./checkout-status.service");
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
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
              reviewSandboxLayer,
              dotyposLayer(makeDotypos()),
              noLatePaymentLayer(),
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
      verificationDeadline: Duration.seconds(40),
    });
    expect(status.status).toBe("fulfilled");
  });

  test("reports a review account's sandbox order the ledger doesn't hold", async () => {
    const { CheckoutStatusService } = await import("./checkout-status.service");
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );

    const orderId = "review-sample-order";
    const sandboxStatus = {
      kind: "meeting-room",
      orderId,
      returnOutcome: "unknown",
      status: "fulfilled",
      paymentStatus: "paid",
      fulfillmentStatus: "fulfilled",
      reviewSandbox: true,
    } as const;
    const sandboxLookup = mock(() =>
      Effect.succeed(Option.some(sandboxStatus))
    );

    const status = await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.getStatus({ orderId, returnOutcome: "unknown" });
    }).pipe(
      Effect.provide(
        CheckoutStatusService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderPaymentFinalizationService, {}),
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(null)),
              }),
              Layer.mock(PaymentAttemptRepository, {}),
              ReviewSandboxMock({ status: sandboxLookup }),
              dotyposLayer(makeDotypos()),
              noLatePaymentLayer(),
              SeatingMapFeatureFlagServiceMock({
                isEnabled: Effect.succeed(true),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(status).toEqual(sandboxStatus);
    expect(sandboxLookup).toHaveBeenCalledWith({
      orderId,
      returnOutcome: "unknown",
    });
  });

  test("renders the stored status without late-payment recovery after refresh finds terminal payment", async () => {
    const { CheckoutStatusService } = await import("./checkout-status.service");
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );

    const orderId = "reservation-provider-return";
    const startRecoveryIfSettled = mock(() =>
      Effect.succeed("not_applicable" as const)
    );
    const finalization: ProviderPaymentFinalizationServiceType = {
      finalizePendingProviderPayment: mock(() =>
        Effect.succeed("terminal" as const)
      ),
    };
    const reservations = {
      findById: mock(() => Effect.succeed(makeReservation())),
    };
    const paymentAttempts = {
      findDisplayableForReservation: mock(() => Effect.succeed(null)),
      // A just-created provider order is inside its abandonment window.
      findById: mock(() =>
        Effect.succeed(
          makePaymentAttempt({
            state: "pending",
            providerOrderCreatedAt: Temporal.Now.instant(),
          })
        )
      ),
    };

    const status = await Effect.gen(function* () {
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
              reviewSandboxLayer,
              dotyposLayer(makeDotypos()),
              Layer.mock(LatePaymentRecoveryRepository, {
                findLatestByWorkspaceReservationId: mock(() =>
                  Effect.succeed(null)
                ),
              }),
              Layer.mock(LatePaymentVerificationService, {
                startRecoveryIfSettled,
              }),
              SeatingMapFeatureFlagServiceMock({
                isEnabled: Effect.succeed(true),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(reservations.findById).toHaveBeenCalledTimes(1);
    expect(startRecoveryIfSettled).not.toHaveBeenCalled();
    expect(status.status).toBe("pending");
  });

  test("reconstructs an internal zero-total fulfilled reservation without PII", async () => {
    const { CheckoutStatusService } = await import("./checkout-status.service");
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
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
      getReservationWithoutCustomer: mock(() =>
        Effect.succeed({
          id: "dotypos-reservation-id",
          _customerId: "customer-id",
          _tableId: "assigned-table",
          startDate: "2026-06-19T22:00:00.000Z",
          endDate: "2026-06-20T22:00:00.000Z",
          seats: "1",
          status: "CONFIRMED",
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
                reviewSandboxLayer,
                dotyposLayer(dotypos),
                noLatePaymentLayer(),
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
      table: { mode: "assigned", name: "Desk 1" },
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
    expect(statusWithoutSeatingMap.table).toEqual({
      mode: "assigned",
      name: "Desk 1",
    });
    expect(statusWithoutSeatingMap.tableMap).toBeUndefined();
    expect(getTables).toHaveBeenCalledTimes(2);

    failTableLookup = true;
    const statusWithoutTables = await loadStatus(true);

    expect(statusWithoutTables.summary).toEqual(status.summary);
    expect(statusWithoutTables.table).toEqual({
      mode: "assigned",
      name: "assigned-table",
    });
    expect(statusWithoutTables.tableMap).toBeUndefined();
    expect(getTables).toHaveBeenCalledTimes(3);
  });

  test("uses the shared Open Space table list instead of its assigned table", async () => {
    const { CheckoutStatusService } = await import("./checkout-status.service");
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
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
            reservationDetails: {
              kind: "cowork",
              entryTier: "open-space",
              coffee: false,
            },
            productTier: "open-space",
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
    const dotypos = makeDotypos({
      getReservationWithoutCustomer: mock(() =>
        Effect.succeed({
          id: "dotypos-reservation-id",
          _customerId: "customer-id",
          _tableId: "assigned-only-table-id",
          startDate: "2026-06-19T22:00:00.000Z",
          endDate: "2026-06-20T22:00:00.000Z",
          seats: "1",
          status: "CONFIRMED",
        })
      ),
      getTables: mock(() =>
        Effect.succeed([
          {
            _cloudId: "cloud-id",
            display: true,
            enabled: true,
            id: "open-space-12",
            name: "12",
            seats: "1",
            tags: ["cowork:open-space"],
          },
          {
            _cloudId: "cloud-id",
            display: true,
            enabled: true,
            id: "open-space-10",
            name: "10",
            seats: "1",
            tags: ["cowork:open-space"],
          },
          {
            _cloudId: "cloud-id",
            display: true,
            enabled: true,
            id: "open-space-11",
            name: "11",
            seats: "1",
            tags: ["cowork:open-space"],
          },
          {
            _cloudId: "cloud-id",
            display: true,
            enabled: true,
            id: "open-space-9",
            name: "9",
            seats: "1",
            tags: ["cowork:open-space"],
          },
          {
            _cloudId: "cloud-id",
            display: true,
            enabled: true,
            id: "open-space-15",
            name: "15",
            seats: "1",
            tags: ["cowork:open-space"],
          },
          {
            _cloudId: "cloud-id",
            display: true,
            enabled: true,
            id: "open-space-16",
            name: "16",
            seats: "1",
            tags: ["cowork:open-space"],
          },
          {
            _cloudId: "cloud-id",
            display: true,
            enabled: true,
            id: "assigned-only-table-id",
            name: "Assigned-only sentinel",
            seats: "1",
            tags: ["cowork:reserved-desk"],
          },
          {
            _cloudId: "cloud-id",
            display: true,
            enabled: true,
            id: "monitored-open-space",
            name: "Monitored sentinel",
            seats: "1",
            tags: ["cowork:open-space", "monitor:2x27-qhd"],
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
              reviewSandboxLayer,
              dotyposLayer(dotypos),
              noLatePaymentLayer(),
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
      kind: "cowork",
      status: "fulfilled",
      table: { mode: "shared", name: "9-12, 15, 16" },
      summary: {
        kind: "cowork",
        entryTier: "open-space",
        coffee: false,
      },
    });
    expect(status.table?.name).not.toContain("Assigned-only sentinel");
    expect(status.table?.name).not.toContain("Monitored sentinel");
  });

  test("reconstructs meeting-room timing from Dotypos", async () => {
    const { CheckoutStatusService } = await import("./checkout-status.service");
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
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
    const dotypos = makeDotypos({
      getReservationWithoutCustomer: mock(() =>
        Effect.succeed({
          id: "dotypos-reservation-id",
          _customerId: "customer-id",
          _tableId: "meeting-room-table",
          startDate: "2026-06-20T07:00:00.000Z",
          endDate: "2026-06-20T11:00:00.000Z",
          seats: "12",
          status: "CONFIRMED",
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
              reviewSandboxLayer,
              dotyposLayer(dotypos),
              noLatePaymentLayer(),
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
    const dotypos = makeDotypos({
      getReservationWithoutCustomer: mock(() =>
        Effect.succeed({
          id: "dotypos-reservation-id",
          _customerId: "customer-id",
          _tableId: "office-table",
          startDate: "2026-06-11T22:00:00.000Z",
          endDate: "2026-06-14T22:00:00.000Z",
          seats: "3",
          status: "CONFIRMED",
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
              reviewSandboxLayer,
              dotyposLayer(dotypos),
              noLatePaymentLayer(),
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

  describe("a paid reservation whose fulfillment has not completed", () => {
    const paidAt = testInstant("2026-06-01T10:00:00.000Z");

    const makeContactDotypos = () =>
      makeDotypos({
        getCustomer: mock(() =>
          Effect.succeed({
            id: "customer-id",
            firstName: "Ada",
            lastName: "Lovelace",
            email: testEmailAddress("ada"),
          })
        ),
      });

    const getPaidStatus = async (
      now: Temporal.Instant,
      overrides: Partial<ReturnType<typeof makeReservation>> = {},
      {
        dotypos = makeContactDotypos(),
        includeSupportContact,
      }: {
        readonly dotypos?: ReturnType<typeof makeDotypos>;
        readonly includeSupportContact?: boolean;
      } = {}
    ) => {
      const { CheckoutStatusService } = await import(
        "./checkout-status.service"
      );
      const { ProviderPaymentFinalizationService } = await import(
        "../payment/provider-payment-finalization.service"
      );
      const { WorkspaceReservationRepository } = await import(
        "@/features/reservation/backend/workspace-reservation.repository"
      );
      const { PaymentAttemptRepository } = await import(
        "../repositories/payment-attempt.repository"
      );

      return Effect.gen(function* () {
        yield* TestClock.setTime(now.epochMilliseconds);
        const service = yield* CheckoutStatusService;
        return yield* service.getStatus({
          orderId: "reservation-provider-return",
          returnOutcome: "success",
          ...(includeSupportContact !== undefined && { includeSupportContact }),
        });
      }).pipe(
        Effect.provide(
          CheckoutStatusService.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(ProviderPaymentFinalizationService, {
                  finalizePendingProviderPayment: mock(() =>
                    Effect.die("not used")
                  ),
                }),
                Layer.mock(WorkspaceReservationRepository, {
                  findById: mock(() =>
                    Effect.succeed(
                      makeReservation({
                        reservationState: "confirmed",
                        reservationConfirmedAt: paidAt,
                        paymentState: "paid",
                        paidAt,
                        fulfillmentState: "awaiting_delivery",
                        activeCustomerEmailDeliveryId: "delivery-id",
                        ...overrides,
                      })
                    )
                  ),
                }),
                Layer.mock(PaymentAttemptRepository, {
                  findDisplayableForReservation: mock(() =>
                    Effect.succeed(makePaymentAttempt())
                  ),
                  findById: mock(() =>
                    Effect.succeed(
                      makePaymentAttempt({
                        state: "pending",
                        providerOrderCreatedAt: paidAt,
                      })
                    )
                  ),
                }),
                reviewSandboxLayer,
                dotyposLayer(dotypos),
                noLatePaymentLayer(),
                SeatingMapFeatureFlagServiceMock({
                  isEnabled: Effect.succeed(false),
                })
              )
            )
          )
        ),
        Effect.provide(TestClock.layer()),
        Effect.runPromise
      );
    };

    test("tells the customer where the confirmation went while delivery is recent", async () => {
      const status = await getPaidStatus(paidAt.add({ minutes: 2 }));

      expect(status).toMatchObject({
        status: "paid_awaiting_delivery",
        supportContactPrefill: { email: testEmailAddress("ada") },
      });
    });

    test("skips the contact read for a caller that never shows it", async () => {
      const dotypos = makeContactDotypos();

      const status = await getPaidStatus(
        paidAt.add({ minutes: 2 }),
        {},
        { dotypos, includeSupportContact: false }
      );

      expect(status).toMatchObject({
        status: "paid_awaiting_delivery",
        supportContactPrefill: undefined,
      });
      expect(dotypos.getCustomer).not.toHaveBeenCalled();
    });

    // The reservation details may come from a shared snapshot taken before
    // the hold was confirmed; the status comes from the Workspace rows.
    test("reports a paid booking from Workspace rows even when its reservation details still say NEW", async () => {
      const dotypos = makeContactDotypos();
      dotypos.getReservationWithoutCustomer.mockImplementation(() =>
        Effect.succeed({
          id: "dotypos-reservation-id",
          _customerId: "customer-id",
          startDate: "2026-06-20T00:00:00.000+02:00",
          endDate: "2026-06-21T00:00:00.000+02:00",
          seats: "1",
          status: "NEW",
        })
      );

      const status = await getPaidStatus(
        paidAt.add({ minutes: 2 }),
        { fulfillmentState: "fulfilled", fulfilledAt: paidAt },
        { dotypos }
      );

      expect(status).toMatchObject({
        status: "fulfilled",
        paymentStatus: "paid",
        summary: { price: { value: 55_000 } },
      });
      expect(dotypos.getReservationWithoutCustomer).toHaveBeenCalledTimes(1);
    });

    test("does not call a reservation confirmed before Dotypos confirms it", async () => {
      const status = await getPaidStatus(paidAt.add({ minutes: 2 }), {
        reservationState: "confirming",
        reservationConfirmedAt: null,
        fulfillmentState: "processing",
        activeCustomerEmailDeliveryId: null,
      });

      expect(status).toMatchObject({ status: "paid_waiting_fulfillment" });
    });

    test("reports a fulfillment retry that outlasts the wait as delayed, with a support contact", async () => {
      // A retry after a failed send keeps that send as its generation marker.
      const status = await getPaidStatus(paidAt.add({ minutes: 30 }), {
        fulfillmentState: "processing",
        activeCustomerEmailDeliveryId: "failed-delivery-id",
      });

      expect(status).toMatchObject({
        status: "paid_fulfillment_delayed",
        supportContactPrefill: { email: testEmailAddress("ada") },
      });
    });

    const pendingPayment = {
      paymentState: "pending",
      paidAt: null,
      reservationState: "held",
      reservationConfirmedAt: null,
      fulfillmentState: "not_started",
      activeCustomerEmailDeliveryId: null,
    } as const;

    test("keeps a payment inside the provider abandonment window pending", async () => {
      const status = await getPaidStatus(
        paidAt.add({ minutes: 5 }),
        pendingPayment
      );

      expect(status).toMatchObject({ status: "pending" });
    });

    test("offers support for a payment still unconfirmed after the abandonment cutoff", async () => {
      const status = await getPaidStatus(
        paidAt.add({ minutes: 45 }),
        pendingPayment
      );

      expect(status).toMatchObject({
        status: "payment_pending_delayed",
        supportContactPrefill: { email: testEmailAddress("ada") },
      });
    });

    test("keeps a bounced confirmation as a failed fulfillment with its address", async () => {
      const status = await getPaidStatus(paidAt.add({ minutes: 2 }), {
        fulfillmentState: "failed",
        fulfillmentFailedAt: paidAt.add({ minutes: 1 }),
        fulfillmentFailureCode: "fulfillment_email_failed",
      });

      expect(status).toMatchObject({
        status: "fulfillment_failed",
        supportContactPrefill: { email: testEmailAddress("ada") },
      });
    });

    // A confirmation that never reports delivery, such as one sent to an
    // address whose domain check was inconclusive, must not keep promising
    // automatic completion.
    test("reports a delivery that never arrived as delayed, with a support contact", async () => {
      const status = await getPaidStatus(paidAt.add({ minutes: 45 }));

      expect(status).toMatchObject({
        status: "paid_delivery_delayed",
        supportContactPrefill: {
          name: "Ada Lovelace",
          email: testEmailAddress("ada"),
        },
      });
    });
  });

  test("omits summary but keeps the retry selection when only a failed payment attempt is available", async () => {
    const { CheckoutStatusService } = await import("./checkout-status.service");
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
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
            reservationDetails: {
              kind: "cowork",
              entryTier: "reserved-desk",
              coffee: true,
              monitorOption: "2x27-qhd",
            },
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
    const getReservationWithoutCustomer =
      makeDotypos().getReservationWithoutCustomer;

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
              reviewSandboxLayer,
              dotyposLayer(makeDotypos({ getReservationWithoutCustomer })),
              noLatePaymentLayer(),
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
    // Only the retry selection reads the reservation; the failed attempt's
    // amount never reaches the page.
    expect(getReservationWithoutCustomer).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({
      retrySearchParams: { entryTier: "reserved-desk", date: "2026-06-20" },
    });
  });

  test("keeps status renderable when Dotypos summary lookup fails", async () => {
    const { CheckoutStatusService } = await import("./checkout-status.service");
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
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
              reviewSandboxLayer,
              dotyposLayer(
                makeDotypos({
                  getReservationWithoutCustomer: mock(() =>
                    Effect.fail("down")
                  ),
                })
              ),
              noLatePaymentLayer(),
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

describe("CheckoutStatusService retry selection", () => {
  const getStatusFor = async ({
    dotypos = makeDotypos(),
    elapsed,
    latePaymentRecovery = null,
    reservation,
  }: {
    readonly dotypos?: ReturnType<typeof makeDotypos>;
    /** Runs on a test clock advanced by this much while the status loads. */
    readonly elapsed?: Duration.Input;
    readonly latePaymentRecovery?: object | null;
    readonly reservation: ReturnType<typeof makeReservation>;
  }) => {
    const { CheckoutStatusService } = await import("./checkout-status.service");
    const { ProviderPaymentFinalizationService } = await import(
      "../payment/provider-payment-finalization.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
    );

    const getStatus = Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.getStatus({
        orderId: "reservation-provider-return",
        returnOutcome: "cancelled",
      });
    });

    return (
      elapsed === undefined
        ? getStatus
        : Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(getStatus);
            yield* TestClock.adjust(elapsed);
            return yield* Fiber.join(fiber);
          }).pipe(Effect.provide(TestClock.layer()))
    ).pipe(
      Effect.provide(
        CheckoutStatusService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderPaymentFinalizationService, {
                finalizePendingProviderPayment: mock(() =>
                  Effect.die("not used")
                ),
              }),
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(reservation)),
              }),
              Layer.mock(PaymentAttemptRepository, {
                findDisplayableForReservation: mock(() =>
                  Effect.succeed(makePaymentAttempt({ state: "failed" }))
                ),
                findById: mock(() =>
                  Effect.succeed(makePaymentAttempt({ state: "failed" }))
                ),
              }),
              reviewSandboxLayer,
              dotyposLayer(dotypos),
              Layer.mock(LatePaymentRecoveryRepository, {
                findLatestByWorkspaceReservationId: mock(() =>
                  Effect.succeed(latePaymentRecovery)
                ),
              }),
              Layer.mock(LatePaymentVerificationService, {
                startRecoveryIfSettled: mock(() =>
                  Effect.succeed("not_applicable" as const)
                ),
              }),
              SeatingMapFeatureFlagServiceMock({
                isEnabled: Effect.succeed(false),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );
  };

  test.each([
    { paymentState: "failed", status: "payment_failed" },
    { paymentState: "cancelled", status: "cancelled" },
    { paymentState: "expired", status: "expired" },
  ])(
    "rebuilds the booked cowork selection after a $paymentState payment",
    async ({ paymentState, status }) => {
      const result = await getStatusFor({
        reservation: makeReservation({
          paymentState,
          reservationState: "cancelled",
          reservationDetails: {
            kind: "cowork",
            entryTier: "reserved-desk",
            coffee: true,
            monitorOption: "2x27-qhd",
          },
        }),
        dotypos: makeDotypos({
          getReservationWithoutCustomer: mock(() =>
            Effect.succeed({
              id: "dotypos-reservation-id",
              _customerId: "customer-id",
              startDate: "2099-06-12T00:00:00.000+02:00",
              endDate: "2099-06-13T00:00:00.000+02:00",
              seats: "1",
              status: "CANCELLED",
            })
          ),
        }),
      });

      expect(result.status).toBe(status);
      expect(result).toMatchObject({
        retrySearchParams: {
          entryTier: "reserved-desk",
          date: "2099-06-12",
          coffee: "true",
          monitorOption: "2x27-qhd",
        },
      });
    }
  );

  test("rebuilds the booked meeting-room start and duration", async () => {
    const result = await getStatusFor({
      reservation: makeReservation({
        paymentState: "failed",
        reservationDetails: {
          kind: "meeting-room",
          duration: { unit: "hour", amount: 4 },
        },
      }),
      dotypos: makeDotypos({
        getReservationWithoutCustomer: mock(() =>
          Effect.succeed({
            id: "dotypos-reservation-id",
            _customerId: "customer-id",
            startDate: "2099-08-13T14:00:00.000+02:00",
            endDate: "2099-08-13T18:00:00.000+02:00",
            seats: "1",
            status: "NEW",
          })
        ),
      }),
    });

    expect(result).toMatchObject({
      retrySearchParams: {
        startDateTime: "2099-08-13T14:00",
        duration: "hour:4",
      },
    });
  });

  test("rebuilds the booked office start date, day count, and seats", async () => {
    const result = await getStatusFor({
      reservation: makeReservation({
        paymentState: "expired",
        reservationDetails: { kind: "office", dayCount: 3, seats: 2 },
      }),
      dotypos: makeDotypos({
        getReservationWithoutCustomer: mock(() =>
          Effect.succeed({
            id: "dotypos-reservation-id",
            _customerId: "customer-id",
            startDate: "2099-06-20T00:00:00.000+02:00",
            endDate: "2099-06-23T00:00:00.000+02:00",
            seats: "3",
            status: "CANCELLED",
          })
        ),
      }),
    });

    expect(result).toMatchObject({
      retrySearchParams: { startsOn: "2099-06-20", dayCount: "3", seats: "3" },
    });
  });

  test("renders a retry status without a selection when Dotypos can't load the reservation", async () => {
    const result = await getStatusFor({
      reservation: makeReservation({ paymentState: "failed" }),
      dotypos: makeDotypos({
        getReservationWithoutCustomer: mock(() => Effect.fail("down")),
      }),
    });

    expect(result.status).toBe("payment_failed");
    expect(result).not.toHaveProperty("retrySearchParams");
  });

  test("renders a retry status without a selection when Dotypos doesn't answer in time", async () => {
    const result = await getStatusFor({
      reservation: makeReservation({ paymentState: "cancelled" }),
      dotypos: makeDotypos({
        getReservationWithoutCustomer: mock(() => Effect.never),
      }),
      elapsed: "8 seconds",
    });

    expect(result.status).toBe("cancelled");
    expect(result).not.toHaveProperty("retrySearchParams");
  });

  test("offers no retry once a late payment for the expired checkout takes over", async () => {
    const result = await getStatusFor({
      reservation: makeReservation({ paymentState: "expired" }),
      latePaymentRecovery: {
        id: "late-payment-recovery",
        paymentAttemptId: "attempt-provider-return",
        state: "refund_required",
      },
    });

    expect(result.status).toBe("late_payment_refund");
    expect(result).not.toHaveProperty("retrySearchParams");
  });

  test("never reads the reservation for a payment that is still pending", async () => {
    const dotypos = makeDotypos();
    const result = await getStatusFor({
      reservation: makeReservation({ paymentState: "pending" }),
      dotypos,
    });

    expect(result).not.toHaveProperty("retrySearchParams");
    // Only the summary reconstruction reads it.
    expect(dotypos.getReservationWithoutCustomer).toHaveBeenCalledTimes(1);
  });
});
