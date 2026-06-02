import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import type { CreateDotyposReservationInput } from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import type { PaymentOrderRepository as PaymentOrderTestRepository } from "@/features/checkout/backend/payment-order.repository";
import { checkoutDetailsJsonSchema } from "@/features/checkout/schemas/checkout-details";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import type { ReservationOrderData } from "@/features/reservation/schemas/reservation";

mock.module("server-only", () => ({}));

type DotyposTestService = typeof DotyposService.Service;

const reservationInput = {
  entryTier: "basic",
  date: "2099-06-10",
  coffee: false,
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420777123456",
  message: "hello",
} satisfies ReservationOrderData;

const makePaymentOrder = (input: {
  readonly id: string;
  readonly dotyposCustomerId?: string;
  readonly checkoutDetails: Omit<CheckoutDetailsJson, "fulfillment">;
  readonly reservationSubmitKey?: string;
  readonly reservationHoldExpiresAt?: Date;
  readonly dotyposReservationId?: string | null;
  readonly dotyposReservationStatus?: string | null;
}) => ({
  id: input.id,
  provider: "nexi" as const,
  dotyposCustomerId: input.dotyposCustomerId ?? "customer",
  correlationId: "correlation",
  checkoutDetails: checkoutDetailsJsonSchema.parse({
    ...input.checkoutDetails,
    fulfillment: { accessCodePolicy: "workspace-static-v1" },
  }),
  reservationSubmitKey: input.reservationSubmitKey ?? null,
  dotyposReservationId: input.dotyposReservationId ?? null,
  dotyposReservationStatus: input.dotyposReservationStatus ?? "none",
  securityToken: null,
  paymentStatus: "created" as const,
  fulfillmentStatus: "not_started" as const,
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  paidAt: null,
  reservationCreatedAt: null,
  reservationHoldExpiresAt: input.reservationHoldExpiresAt ?? null,
  reservationHoldExpiredAt: null,
  reservationConfirmedAt: null,
  reservationCancelledAt: null,
  reservationCancellationFailureCode: null,
  reservationCancellationFailureMessage: null,
  customerAccessEmailSentAt: null,
  internalNotificationSentAt: null,
  fulfilledAt: null,
  fulfillmentFailedAt: null,
  fulfillmentFailureCode: null,
  createdAt: new Date("2026-06-01T10:00:00.000Z"),
  updatedAt: new Date("2026-06-01T10:00:00.000Z"),
});

const makeTable = (id: string): Table => ({
  _cloudId: "cloud",
  id,
  name: id,
  display: true,
  enabled: true,
  tags: ["tier:basic"],
});

const makeDotypos = (overrides: Partial<DotyposTestService> = {}) => ({
  createReservation: mock(() =>
    Effect.succeed({ id: "reservation-new" } satisfies Reservation)
  ),
  cancelReservation: mock(() => Effect.void),
  confirmReservation: mock(() => Effect.void),
  getReservation: mock(() => Effect.die("getReservation not mocked")),
  getCustomer: mock(() => Effect.succeed({ id: "customer", email: "ada@example.com" })),
  getCustomerDiscount: mock(() => Effect.succeed(undefined)),
  findCustomer: mock(() => Effect.succeed({ _tag: "NotFound" as const, matches: [] })),
  findOrCreateCustomer: mock(() => Effect.succeed({ id: "customer" })),
  getTables: mock(() => Effect.succeed([makeTable("table-basic")])),
  listReservations: mock(() => Effect.succeed([])),
  getProducts: mock(() => Effect.succeed([])),
  getCategories: mock(() => Effect.succeed([])),
  ...overrides,
} satisfies DotyposTestService);

const makePaymentOrderRepository = (
  overrides: Partial<PaymentOrderTestRepository>
) => ({
  create: mock(() => Effect.die("create not mocked")),
  findByReservationSubmitKey: mock(() => Effect.succeed(null)),
  mergeLegalEvidence: mock(() => Effect.die("mergeLegalEvidence not mocked")),
  updateCheckoutDetails: mock((input) =>
    Effect.succeed(
      makePaymentOrder({
        id: input.id,
        checkoutDetails: input.checkoutDetails,
      })
    )
  ),
  deleteUnassociatedCreated: mock(() => Effect.die("deleteUnassociatedCreated not mocked")),
  attachNexiSession: mock(() => Effect.die("attachNexiSession not mocked")),
  claimNexiSessionCreation: mock(() => Effect.die("claimNexiSessionCreation not mocked")),
  findById: mock(() => Effect.die("findById not mocked")),
  markPaymentPending: mock(() => Effect.die("markPaymentPending not mocked")),
  resetUnsuccessfulForRetry: mock(() => Effect.die("resetUnsuccessfulForRetry not mocked")),
  markPaid: mock(() => Effect.die("markPaid not mocked")),
  markFailed: mock(() => Effect.die("markFailed not mocked")),
  markCancelled: mock(() => Effect.die("markCancelled not mocked")),
  markExpired: mock(() => Effect.die("markExpired not mocked")),
  markUnsuccessfulTerminal: mock(() => Effect.die("markUnsuccessfulTerminal not mocked")),
  attachDotyposReservation: mock(() => Effect.die("attachDotyposReservation not mocked")),
  claimReservationCreation: mock(() => Effect.succeed(true)),
  releaseReservationCreation: mock(() => Effect.void),
  attachNewReservationHold: mock(() => Effect.void),
  markReservationAttachCancellationPending: mock(() => Effect.void),
  claimReservationCancellation: mock(() => Effect.die("claimReservationCancellation not mocked")),
  markReservationCancelled: mock(() => Effect.die("markReservationCancelled not mocked")),
  markReservationCancellationFailed: mock(() => Effect.die("markReservationCancellationFailed not mocked")),
  markReservationConfirmed: mock(() => Effect.die("markReservationConfirmed not mocked")),
  selectExpiredReservationHolds: mock(() => Effect.die("selectExpiredReservationHolds not mocked")),
  claimPaidFulfillment: mock(() => Effect.die("claimPaidFulfillment not mocked")),
  markCustomerAccessEmailSent: mock(() => Effect.die("markCustomerAccessEmailSent not mocked")),
  markInternalNotificationSent: mock(() => Effect.die("markInternalNotificationSent not mocked")),
  markFulfilled: mock(() => Effect.die("markFulfilled not mocked")),
  markFulfillmentFailed: mock(() => Effect.die("markFulfillmentFailed not mocked")),
  ...overrides,
} satisfies PaymentOrderTestRepository);

const runPrepare = async (input: {
  readonly dotypos?: DotyposTestService;
  readonly paymentOrders: PaymentOrderTestRepository;
  readonly recovery?: { readonly recordAttachFailure: ReturnType<typeof mock> };
  readonly holdCleanup?: { readonly cancelOrderHold: ReturnType<typeof mock> };
}) => {
  const { prepareWorkspacePayStateEffect } = await import("./prepare-pay-state");
  const paymentOrderRepository = await import(
    "@/features/checkout/backend/payment-order.repository"
  );
  const legalEvidenceAuditRepository = await import(
    "@/features/checkout/backend/legal-evidence-audit.repository"
  );
  const reservationRecoveryRepository = await import(
    "@/features/checkout/backend/reservation-recovery.repository"
  );
  const availability = await import(
    "@/features/reservation/backend/workspace-availability.service"
  );
  const cleanup = await import(
    "@/features/checkout/backend/reservation-hold-cleanup.service"
  );
  const tableAssignment = await import(
    "@/features/checkout/backend/workspace-table-assignment.service"
  );

  return prepareWorkspacePayStateEffect({
    locale: "en-US",
    reservation: reservationInput,
    legalConsent: true,
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(DotyposService, input.dotypos ?? makeDotypos()),
        Layer.succeed(
          paymentOrderRepository.PaymentOrderRepository,
          input.paymentOrders
        ),
        Layer.succeed(legalEvidenceAuditRepository.LegalEvidenceAuditRepository, {
          recordRejected: mock(() => Effect.die("recordRejected not mocked")),
        }),
        Layer.succeed(reservationRecoveryRepository.ReservationRecoveryRepository, {
          recordAttachFailure:
            input.recovery?.recordAttachFailure ??
            mock(() => Effect.die("recordAttachFailure not mocked")),
        }),
        Layer.succeed(cleanup.ReservationHoldCleanupService, {
          cancelOrderHold:
            input.holdCleanup?.cancelOrderHold ??
            mock(() => Effect.die("cancelOrderHold not mocked")),
          sweepExpiredHolds: mock(() =>
            Effect.die("sweepExpiredHolds not mocked")
          ),
        }),
        Layer.succeed(availability.WorkspaceAvailabilityService, {
          getAvailability: mock(() => Effect.die("getAvailability not mocked")),
          ensureAvailable: mock(() => Effect.void),
        }),
        Layer.succeed(tableAssignment.WorkspaceTableAssignmentService, {
          assignTableId: mock(() => Effect.succeed("table-basic")),
        })
      )
    ),
    Effect.runPromise
  );
};

describe("prepareWorkspacePayStateEffect", () => {
  beforeAll(() => {
    delete process.env.NEXI_CHECKOUT_CURRENCY_OVERRIDE;
  });

  test("creates local order and Dotypos NEW hold before returning pay redirect", async () => {
    let storedOrder: ReturnType<typeof makePaymentOrder> | null = null;
    const createReservation = mock((input: CreateDotyposReservationInput) =>
      Effect.succeed({ id: "reservation-new", status: input.status } satisfies Reservation)
    );
    const paymentOrders = makePaymentOrderRepository({
      create: mock((input) => {
        storedOrder = makePaymentOrder(input);
        return Effect.succeed(storedOrder);
      }),
      findByReservationSubmitKey: mock(() => Effect.succeed(null)),
      claimReservationCreation: mock(() => Effect.succeed(true)),
      attachNewReservationHold: mock((input) => {
        if (storedOrder) {
          storedOrder = {
            ...storedOrder,
            dotyposReservationId: input.dotyposReservationId,
            dotyposReservationStatus: "NEW",
            reservationCreatedAt: input.reservationCreatedAt,
          };
        }
        return Effect.void;
      }),
      releaseReservationCreation: mock(() => Effect.void),
    });

    const result = await runPrepare({
      paymentOrders,
      dotypos: makeDotypos({ createReservation }),
    });

    expect(result.status).toBe("ready");
    expect(result.status === "ready" && result.redirectUrl).toStartWith(
      "/en-US/checkout/pay?"
    );
    expect(paymentOrders.create).toHaveBeenCalledTimes(1);
    expect(paymentOrders.claimReservationCreation).toHaveBeenCalledTimes(1);
    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(createReservation.mock.calls[0]?.[0].status).toBe("NEW");
    expect(paymentOrders.attachNewReservationHold).toHaveBeenCalledWith({
      id: storedOrder?.id,
      dotyposReservationId: "reservation-new",
      reservationCreatedAt: expect.any(Date),
      reservationHoldExpiresAt: expect.any(Date),
    });
    expect(storedOrder?.dotyposReservationStatus).toBe("NEW");
  });

  test("duplicate same customer and reservation tuple reuses existing hold", async () => {
    let createdOrder: ReturnType<typeof makePaymentOrder> | null = null;
    const createReservation = mock(() =>
      Effect.succeed({ id: "reservation-new" } satisfies Reservation)
    );
    const paymentOrders = makePaymentOrderRepository({
      create: mock((input) => {
        createdOrder = makePaymentOrder(input);
        return Effect.succeed(createdOrder);
      }),
      findByReservationSubmitKey: mock(() => Effect.succeed(createdOrder)),
      updateCheckoutDetails: mock((input) => {
        if (createdOrder) {
          createdOrder = makePaymentOrder({
            ...createdOrder,
            checkoutDetails: input.checkoutDetails,
            dotyposReservationId: createdOrder.dotyposReservationId,
            dotyposReservationStatus: createdOrder.dotyposReservationStatus,
          });
        }
        return Effect.succeed(createdOrder);
      }),
      claimReservationCreation: mock(() => Effect.succeed(true)),
      attachNewReservationHold: mock((input) => {
        if (createdOrder) {
          createdOrder = {
            ...createdOrder,
            dotyposReservationId: input.dotyposReservationId,
            dotyposReservationStatus: "NEW",
          };
        }
        return Effect.void;
      }),
      releaseReservationCreation: mock(() => Effect.void),
    });
    const dotypos = makeDotypos({ createReservation });

    const first = await runPrepare({ paymentOrders, dotypos });
    const second = await runPrepare({ paymentOrders, dotypos });

    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    expect(paymentOrders.create).toHaveBeenCalledTimes(1);
    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(paymentOrders.attachNewReservationHold).toHaveBeenCalledTimes(1);
    expect(paymentOrders.updateCheckoutDetails).toHaveBeenCalledTimes(1);
  });

  test("expired existing NEW hold is cancelled and replaced on idempotent resubmit", async () => {
    let order = makePaymentOrder({
      id: "expired-order",
      checkoutDetails: {
        schema: "workspace-checkout-details",
        schemaVersion: 1,
        locale: "en-US",
        reservation: {
          tier: reservationInput.entryTier,
          date: reservationInput.date,
          coffee: reservationInput.coffee,
        },
        payment: {
          expectedPrice: { value: 1, currency: "CZK", exponent: 2 },
          quoteFingerprint: "stale",
          summary: {
            sections: [],
            items: [],
            total: { value: 1, currency: "CZK", exponent: 2 },
          },
        },
        legal: {},
      },
      dotyposReservationId: "expired-hold",
      dotyposReservationStatus: "NEW",
      reservationHoldExpiresAt: new Date("2026-06-01T10:00:00.000Z"),
    });
    const cancelOrderHold = mock(() => {
      order = {
        ...order,
        dotyposReservationStatus: "CANCELLED",
        reservationCancelledAt: new Date(),
      };
      return Effect.void;
    });
    const createReservation = mock(() =>
      Effect.succeed({ id: "replacement-hold" } satisfies Reservation)
    );
    const paymentOrders = makePaymentOrderRepository({
      create: mock(() => Effect.die("create should not be used")),
      findByReservationSubmitKey: mock(() => Effect.succeed(order)),
      findById: mock(() => Effect.succeed(order)),
      updateCheckoutDetails: mock((input) => {
        order = makePaymentOrder({
          ...order,
          checkoutDetails: input.checkoutDetails,
          dotyposReservationId: order.dotyposReservationId,
          dotyposReservationStatus: order.dotyposReservationStatus,
        });
        return Effect.succeed(order);
      }),
      claimReservationCreation: mock((id) => {
        if (id !== order.id || order.dotyposReservationStatus !== "CANCELLED") {
          return Effect.succeed(false);
        }

        order = {
          ...order,
          dotyposReservationId: null,
          dotyposReservationStatus: "creating",
        };
        return Effect.succeed(true);
      }),
      attachNewReservationHold: mock((input) => {
        order = {
          ...order,
          dotyposReservationId: input.dotyposReservationId,
          dotyposReservationStatus: "NEW",
          reservationCreatedAt: input.reservationCreatedAt,
          reservationHoldExpiresAt: input.reservationHoldExpiresAt ?? null,
        };
        return Effect.void;
      }),
      releaseReservationCreation: mock(() => Effect.void),
    });

    const result = await runPrepare({
      paymentOrders,
      dotypos: makeDotypos({ createReservation }),
      holdCleanup: { cancelOrderHold },
    });

    expect(result.status).toBe("ready");
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: "expired-order",
      holdExpiredAt: expect.any(Date),
    });
    expect(paymentOrders.create).not.toHaveBeenCalled();
    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(paymentOrders.updateCheckoutDetails).toHaveBeenCalledTimes(1);
    expect(order.dotyposReservationId).toBe("replacement-hold");
    expect(order.dotyposReservationStatus).toBe("NEW");
    expect(order.reservationHoldExpiresAt?.getTime()).toBeGreaterThan(Date.now());
  });

  test("resubmits an existing none lifecycle order after Dotypos create failure", async () => {
    let order: ReturnType<typeof makePaymentOrder> | null = null;
    let createAttempts = 0;
    const createReservation = mock(() => {
      createAttempts += 1;
      return createAttempts === 1
        ? Effect.fail(new Error("Dotypos unavailable"))
        : Effect.succeed({ id: "reservation-retry" } satisfies Reservation);
    });
    const paymentOrders = makePaymentOrderRepository({
      create: mock((input) => {
        order = makePaymentOrder(input);
        return Effect.succeed(order);
      }),
      findByReservationSubmitKey: mock(() => Effect.succeed(order)),
      updateCheckoutDetails: mock((input) => {
        if (order) {
          order = makePaymentOrder({
            ...order,
            checkoutDetails: input.checkoutDetails,
            dotyposReservationStatus: order.dotyposReservationStatus,
          });
        }
        return Effect.succeed(order);
      }),
      claimReservationCreation: mock((id) => {
        if (!order || order.id !== id || order.dotyposReservationStatus !== "none") {
          return Effect.succeed(false);
        }
        order = { ...order, dotyposReservationStatus: "creating" };
        return Effect.succeed(true);
      }),
      releaseReservationCreation: mock(() => {
        if (order) order = { ...order, dotyposReservationStatus: "none" };
        return Effect.void;
      }),
      attachNewReservationHold: mock((input) => {
        if (order) {
          order = {
            ...order,
            dotyposReservationId: input.dotyposReservationId,
            dotyposReservationStatus: "NEW",
          };
        }
        return Effect.void;
      }),
    });

    await expect(
      runPrepare({ paymentOrders, dotypos: makeDotypos({ createReservation }) })
    ).rejects.toThrow("Checkout could not be started");

    const retry = await runPrepare({
      paymentOrders,
      dotypos: makeDotypos({ createReservation }),
    });

    expect(retry.status).toBe("ready");
    expect(paymentOrders.create).toHaveBeenCalledTimes(1);
    expect(createReservation).toHaveBeenCalledTimes(2);
    expect(order?.dotyposReservationId).toBe("reservation-retry");
    expect(order?.dotyposReservationStatus).toBe("NEW");
  });

  test("records and releases attach failure after remote cancellation so idempotent resubmit can retry", async () => {
    let order: ReturnType<typeof makePaymentOrder> | null = null;
    const recordAttachFailure = mock(() => Effect.succeed({ id: "recovery-event" }));
    const createReservation = mock(() =>
      Effect.succeed({ id: "reservation-orphan" } satisfies Reservation)
    );
    const paymentOrders = makePaymentOrderRepository({
      create: mock((input) => {
        order = makePaymentOrder(input);
        return Effect.succeed(order);
      }),
      findByReservationSubmitKey: mock(() => Effect.succeed(order)),
      updateCheckoutDetails: mock((input) => {
        if (order) {
          order = makePaymentOrder({
            ...order,
            checkoutDetails: input.checkoutDetails,
            dotyposReservationStatus: order.dotyposReservationStatus,
          });
        }
        return Effect.succeed(order);
      }),
      claimReservationCreation: mock((id) => {
        if (!order || order.id !== id || order.dotyposReservationStatus !== "none") {
          return Effect.succeed(false);
        }
        order = { ...order, dotyposReservationStatus: "creating" };
        return Effect.succeed(true);
      }),
      releaseReservationCreation: mock(() => {
        if (order) order = { ...order, dotyposReservationStatus: "none" };
        return Effect.void;
      }),
      attachNewReservationHold: mock(() => Effect.fail(new Error("attach failed"))),
    });

    await expect(
      runPrepare({
        paymentOrders,
        dotypos: makeDotypos({ createReservation }),
        recovery: { recordAttachFailure },
      })
    ).rejects.toThrow("Checkout could not be started");

    expect(recordAttachFailure).toHaveBeenCalledWith({
      orderId: order?.id,
      reservationSubmitKey: order?.reservationSubmitKey,
      dotyposCustomerId: order?.dotyposCustomerId,
      dotyposReservationId: "reservation-orphan",
      attemptedCancellationResult: "cancelled",
      cancellationAttemptedAt: expect.any(Date),
      failureReason: "attach_failed",
    });
    expect(order?.dotyposReservationStatus).toBe("none");
  });
});
