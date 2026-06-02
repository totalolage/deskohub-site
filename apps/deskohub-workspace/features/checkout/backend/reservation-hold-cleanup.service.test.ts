import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { PaymentOrder } from "@/db/schema";

mock.module("server-only", () => ({}));

const makeOrder = (overrides: Partial<PaymentOrder> = {}): PaymentOrder => ({
  id: "expired-order-1",
  provider: "nexi",
  dotyposCustomerId: "customer-1",
  correlationId: "correlation-1",
  checkoutDetails: {
    schema: "workspace-checkout-details",
    schemaVersion: 1,
    locale: "en-US",
    reservation: { tier: "basic", date: "2099-06-10", coffee: false },
    payment: {
      expectedPrice: { value: 1000, currency: "CZK", exponent: 2 },
      quoteFingerprint: "fingerprint",
      summary: {
        items: [],
        total: { value: 1000, currency: "CZK", exponent: 2 },
      },
    },
    legal: {},
    fulfillment: { accessCodePolicy: "workspace-static-v1" },
  },
  reservationSubmitKey: "submit-key",
  dotyposReservationId: "dotypos-hold-1",
  dotyposReservationStatus: "NEW",
  securityToken: null,
  paymentStatus: "created",
  fulfillmentStatus: "not_started",
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  paidAt: null,
  reservationCreatedAt: new Date("2026-06-01T09:50:00.000Z"),
  reservationHoldExpiresAt: new Date("2026-06-01T10:00:00.000Z"),
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
  createdAt: new Date("2026-06-01T09:49:00.000Z"),
  updatedAt: new Date("2026-06-01T09:49:00.000Z"),
  ...overrides,
});

describe("ReservationHoldCleanupService", () => {
  test("expired hold cleanup cancels Dotypos and records local cancelled/expired markers", async () => {
    const cleanup = await import("./reservation-hold-cleanup.service");
    const paymentOrderRepository = await import("./payment-order.repository");
    const now = new Date("2026-06-01T10:01:00.000Z");
    const expiredOrder = makeOrder();
    let order = expiredOrder;
    const cancelReservation = mock(() => Effect.void);
    const markReservationCancelled = mock((input) => {
      order = {
        ...order,
        dotyposReservationStatus: "CANCELLED",
        reservationCancelledAt: input.cancelledAt,
        reservationHoldExpiredAt: input.holdExpiredAt ?? null,
      };
      return Effect.void;
    });

    const result = await Effect.gen(function* () {
      const service = yield* cleanup.ReservationHoldCleanupService;
      return yield* service.sweepExpiredHolds({ now, limit: 10 });
    }).pipe(
      Effect.provide(cleanup.ReservationHoldCleanupServiceLive),
      Effect.provide(
        Layer.succeed(paymentOrderRepository.PaymentOrderRepository, {
          create: mock(() => Effect.die("create not used")),
          findByReservationSubmitKey: mock(() => Effect.succeed(null)),
          mergeLegalEvidence: mock(() =>
            Effect.die("mergeLegalEvidence not used")
          ),
          updateCheckoutDetails: mock(() =>
            Effect.die("updateCheckoutDetails not used")
          ),
          deleteUnassociatedCreated: mock(() => Effect.void),
          attachNexiSession: mock(() => Effect.void),
          claimNexiSessionCreation: mock(() => Effect.succeed(false)),
          findById: mock(() => Effect.succeed(order)),
          markPaymentPending: mock(() => Effect.void),
          resetUnsuccessfulForRetry: mock(() =>
            Effect.die("resetUnsuccessfulForRetry not used")
          ),
          markPaid: mock(() => Effect.void),
          markFailed: mock(() => Effect.void),
          markCancelled: mock(() => Effect.void),
          markExpired: mock(() => Effect.void),
          markUnsuccessfulTerminal: mock(() => Effect.void),
          attachDotyposReservation: mock(() => Effect.void),
          claimReservationCreation: mock(() => Effect.succeed(false)),
          releaseReservationCreation: mock(() => Effect.void),
          attachNewReservationHold: mock(() => Effect.void),
          markReservationAttachCancellationPending: mock(() => Effect.void),
          claimReservationCancellation: mock(() => {
            order = {
              ...order,
              dotyposReservationStatus: "cancellation_pending",
            };
            return Effect.succeed(order);
          }),
          markReservationCancelled,
          markReservationCancellationFailed: mock(() => Effect.void),
          markReservationConfirmed: mock(() => Effect.void),
          selectExpiredReservationHolds: mock(() =>
            Effect.succeed([expiredOrder])
          ),
          claimPaidFulfillment: mock(() => Effect.succeed(null)),
          markCustomerAccessEmailSent: mock(() => Effect.succeed(false)),
          markInternalNotificationSent: mock(() => Effect.succeed(false)),
          markFulfilled: mock(() => Effect.succeed(false)),
          markFulfillmentFailed: mock(() => Effect.void),
        })
      ),
      Effect.provide(
        Layer.succeed(DotyposService, {
          createReservation: mock(() => Effect.die("createReservation not used")),
          cancelReservation,
          confirmReservation: mock(() => Effect.die("confirmReservation not used")),
          getReservation: mock(() => Effect.die("getReservation not used")),
          getCustomer: mock(() => Effect.die("getCustomer not used")),
          findCustomer: mock(() => Effect.die("findCustomer not used")),
          findOrCreateCustomer: mock(() =>
            Effect.die("findOrCreateCustomer not used")
          ),
          getCustomerDiscount: mock(() =>
            Effect.die("getCustomerDiscount not used")
          ),
          getTables: mock(() => Effect.die("getTables not used")),
          listReservations: mock(() => Effect.die("listReservations not used")),
          getProducts: mock(() => Effect.die("getProducts not used")),
          getCategories: mock(() => Effect.die("getCategories not used")),
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({ cancelled: 1, failed: 0 });
    expect(cancelReservation).toHaveBeenCalledWith("dotypos-hold-1");
    expect(markReservationCancelled).toHaveBeenCalledWith({
      id: "expired-order-1",
      cancelledAt: expect.any(Date),
      holdExpiredAt: now,
    });
    expect(order.dotyposReservationStatus).toBe("CANCELLED");
    expect(order.reservationHoldExpiredAt).toBe(now);
  });

  test("cleanup retries cancellation-pending holds selected by the repository", async () => {
    const cleanup = await import("./reservation-hold-cleanup.service");
    const paymentOrderRepository = await import("./payment-order.repository");
    const now = new Date("2026-06-01T10:05:00.000Z");
    const pendingOrder = makeOrder({
      dotyposReservationStatus: "cancellation_pending",
      reservationCancellationFailureCode: "dotypos_cancel_failed",
      reservationCancellationFailureMessage: "network",
    });
    const cancelReservation = mock(() => Effect.void);
    const markReservationCancelled = mock(() => Effect.void);

    const result = await Effect.gen(function* () {
      const service = yield* cleanup.ReservationHoldCleanupService;
      return yield* service.sweepExpiredHolds({ now, limit: 10 });
    }).pipe(
      Effect.provide(cleanup.ReservationHoldCleanupServiceLive),
      Effect.provide(
        Layer.succeed(paymentOrderRepository.PaymentOrderRepository, {
          create: mock(() => Effect.die("create not used")),
          findByReservationSubmitKey: mock(() => Effect.succeed(null)),
          mergeLegalEvidence: mock(() => Effect.die("mergeLegalEvidence not used")),
          updateCheckoutDetails: mock(() => Effect.die("updateCheckoutDetails not used")),
          deleteUnassociatedCreated: mock(() => Effect.void),
          attachNexiSession: mock(() => Effect.void),
          claimNexiSessionCreation: mock(() => Effect.succeed(false)),
          findById: mock(() => Effect.succeed(pendingOrder)),
          markPaymentPending: mock(() => Effect.void),
          resetUnsuccessfulForRetry: mock(() => Effect.die("resetUnsuccessfulForRetry not used")),
          markPaid: mock(() => Effect.void),
          markFailed: mock(() => Effect.void),
          markCancelled: mock(() => Effect.void),
          markExpired: mock(() => Effect.void),
          markUnsuccessfulTerminal: mock(() => Effect.void),
          attachDotyposReservation: mock(() => Effect.void),
          claimReservationCreation: mock(() => Effect.succeed(false)),
          releaseReservationCreation: mock(() => Effect.void),
          attachNewReservationHold: mock(() => Effect.void),
          markReservationAttachCancellationPending: mock(() => Effect.void),
          claimReservationCancellation: mock(() => Effect.succeed(pendingOrder)),
          markReservationCancelled,
          markReservationCancellationFailed: mock(() => Effect.void),
          markReservationConfirmed: mock(() => Effect.void),
          selectExpiredReservationHolds: mock(() => Effect.succeed([pendingOrder])),
          claimPaidFulfillment: mock(() => Effect.succeed(null)),
          markCustomerAccessEmailSent: mock(() => Effect.succeed(false)),
          markInternalNotificationSent: mock(() => Effect.succeed(false)),
          markFulfilled: mock(() => Effect.succeed(false)),
          markFulfillmentFailed: mock(() => Effect.void),
        })
      ),
      Effect.provide(
        Layer.succeed(DotyposService, {
          createReservation: mock(() => Effect.die("createReservation not used")),
          cancelReservation,
          confirmReservation: mock(() => Effect.die("confirmReservation not used")),
          getReservation: mock(() => Effect.die("getReservation not used")),
          getCustomer: mock(() => Effect.die("getCustomer not used")),
          findCustomer: mock(() => Effect.die("findCustomer not used")),
          findOrCreateCustomer: mock(() => Effect.die("findOrCreateCustomer not used")),
          getCustomerDiscount: mock(() => Effect.die("getCustomerDiscount not used")),
          getTables: mock(() => Effect.die("getTables not used")),
          listReservations: mock(() => Effect.die("listReservations not used")),
          getProducts: mock(() => Effect.die("getProducts not used")),
          getCategories: mock(() => Effect.die("getCategories not used")),
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({ cancelled: 1, failed: 0 });
    expect(cancelReservation).toHaveBeenCalledWith("dotypos-hold-1");
    expect(markReservationCancelled).toHaveBeenCalledWith({
      id: "expired-order-1",
      cancelledAt: expect.any(Date),
      holdExpiredAt: now,
    });
  });

  test("cleanup does not cancel Dotypos when cancellation claim loses to paid status", async () => {
    const cleanup = await import("./reservation-hold-cleanup.service");
    const paymentOrderRepository = await import("./payment-order.repository");
    const now = new Date("2026-06-01T10:05:00.000Z");
    const selectedOrder = makeOrder();
    const paidOrder = makeOrder({ paymentStatus: "paid" });
    const cancelReservation = mock(() => Effect.void);
    const markReservationCancelled = mock(() => Effect.void);

    const result = await Effect.gen(function* () {
      const service = yield* cleanup.ReservationHoldCleanupService;
      return yield* service.sweepExpiredHolds({ now, limit: 10 });
    }).pipe(
      Effect.provide(cleanup.ReservationHoldCleanupServiceLive),
      Effect.provide(
        Layer.succeed(paymentOrderRepository.PaymentOrderRepository, {
          create: mock(() => Effect.die("create not used")),
          findByReservationSubmitKey: mock(() => Effect.succeed(null)),
          mergeLegalEvidence: mock(() => Effect.die("mergeLegalEvidence not used")),
          updateCheckoutDetails: mock(() => Effect.die("updateCheckoutDetails not used")),
          deleteUnassociatedCreated: mock(() => Effect.void),
          attachNexiSession: mock(() => Effect.void),
          claimNexiSessionCreation: mock(() => Effect.succeed(false)),
          findById: mock(() => Effect.succeed(paidOrder)),
          markPaymentPending: mock(() => Effect.void),
          resetUnsuccessfulForRetry: mock(() => Effect.die("resetUnsuccessfulForRetry not used")),
          markPaid: mock(() => Effect.void),
          markFailed: mock(() => Effect.void),
          markCancelled: mock(() => Effect.void),
          markExpired: mock(() => Effect.void),
          markUnsuccessfulTerminal: mock(() => Effect.void),
          attachDotyposReservation: mock(() => Effect.void),
          claimReservationCreation: mock(() => Effect.succeed(false)),
          releaseReservationCreation: mock(() => Effect.void),
          attachNewReservationHold: mock(() => Effect.void),
          markReservationAttachCancellationPending: mock(() => Effect.void),
          claimReservationCancellation: mock(() => Effect.succeed(null)),
          markReservationCancelled,
          markReservationCancellationFailed: mock(() => Effect.void),
          markReservationConfirmed: mock(() => Effect.void),
          selectExpiredReservationHolds: mock(() => Effect.succeed([selectedOrder])),
          claimPaidFulfillment: mock(() => Effect.succeed(null)),
          markCustomerAccessEmailSent: mock(() => Effect.succeed(false)),
          markInternalNotificationSent: mock(() => Effect.succeed(false)),
          markFulfilled: mock(() => Effect.succeed(false)),
          markFulfillmentFailed: mock(() => Effect.void),
        })
      ),
      Effect.provide(
        Layer.succeed(DotyposService, {
          createReservation: mock(() => Effect.die("createReservation not used")),
          cancelReservation,
          confirmReservation: mock(() => Effect.die("confirmReservation not used")),
          getReservation: mock(() => Effect.die("getReservation not used")),
          getCustomer: mock(() => Effect.die("getCustomer not used")),
          findCustomer: mock(() => Effect.die("findCustomer not used")),
          findOrCreateCustomer: mock(() => Effect.die("findOrCreateCustomer not used")),
          getCustomerDiscount: mock(() => Effect.die("getCustomerDiscount not used")),
          getTables: mock(() => Effect.die("getTables not used")),
          listReservations: mock(() => Effect.die("listReservations not used")),
          getProducts: mock(() => Effect.die("getProducts not used")),
          getCategories: mock(() => Effect.die("getCategories not used")),
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({ cancelled: 1, failed: 0 });
    expect(cancelReservation).not.toHaveBeenCalled();
    expect(markReservationCancelled).not.toHaveBeenCalled();
  });

  test("cleanup does not mark paid order cancelled when payment wins after Dotypos cancel", async () => {
    const cleanup = await import("./reservation-hold-cleanup.service");
    const paymentOrderRepository = await import("./payment-order.repository");
    const now = new Date("2026-06-01T10:05:00.000Z");
    let order = makeOrder({ dotyposReservationStatus: "cancellation_pending" });
    const cancelReservation = mock(() => {
      order = { ...order, paymentStatus: "paid" };
      return Effect.void;
    });
    const markReservationCancelled = mock(() =>
      order.paymentStatus === "paid"
        ? Effect.fail(new Error("Only cancellation-pending unpaid reservations can be marked cancelled"))
        : Effect.void
    );

    const result = await Effect.gen(function* () {
      const service = yield* cleanup.ReservationHoldCleanupService;
      return yield* service.sweepExpiredHolds({ now, limit: 10 });
    }).pipe(
      Effect.provide(cleanup.ReservationHoldCleanupServiceLive),
      Effect.provide(
        Layer.succeed(paymentOrderRepository.PaymentOrderRepository, {
          create: mock(() => Effect.die("create not used")),
          findByReservationSubmitKey: mock(() => Effect.succeed(null)),
          mergeLegalEvidence: mock(() => Effect.die("mergeLegalEvidence not used")),
          updateCheckoutDetails: mock(() => Effect.die("updateCheckoutDetails not used")),
          deleteUnassociatedCreated: mock(() => Effect.void),
          attachNexiSession: mock(() => Effect.void),
          claimNexiSessionCreation: mock(() => Effect.succeed(false)),
          findById: mock(() => Effect.succeed(order)),
          markPaymentPending: mock(() => Effect.void),
          resetUnsuccessfulForRetry: mock(() => Effect.die("resetUnsuccessfulForRetry not used")),
          markPaid: mock(() => Effect.void),
          markFailed: mock(() => Effect.void),
          markCancelled: mock(() => Effect.void),
          markExpired: mock(() => Effect.void),
          markUnsuccessfulTerminal: mock(() => Effect.void),
          attachDotyposReservation: mock(() => Effect.void),
          claimReservationCreation: mock(() => Effect.succeed(false)),
          releaseReservationCreation: mock(() => Effect.void),
          attachNewReservationHold: mock(() => Effect.void),
          markReservationAttachCancellationPending: mock(() => Effect.void),
          claimReservationCancellation: mock(() => Effect.succeed(order)),
          markReservationCancelled,
          markReservationCancellationFailed: mock(() => Effect.void),
          markReservationConfirmed: mock(() => Effect.void),
          selectExpiredReservationHolds: mock(() => Effect.succeed([order])),
          claimPaidFulfillment: mock(() => Effect.succeed(null)),
          markCustomerAccessEmailSent: mock(() => Effect.succeed(false)),
          markInternalNotificationSent: mock(() => Effect.succeed(false)),
          markFulfilled: mock(() => Effect.succeed(false)),
          markFulfillmentFailed: mock(() => Effect.void),
        })
      ),
      Effect.provide(
        Layer.succeed(DotyposService, {
          createReservation: mock(() => Effect.die("createReservation not used")),
          cancelReservation,
          confirmReservation: mock(() => Effect.die("confirmReservation not used")),
          getReservation: mock(() => Effect.die("getReservation not used")),
          getCustomer: mock(() => Effect.die("getCustomer not used")),
          findCustomer: mock(() => Effect.die("findCustomer not used")),
          findOrCreateCustomer: mock(() => Effect.die("findOrCreateCustomer not used")),
          getCustomerDiscount: mock(() => Effect.die("getCustomerDiscount not used")),
          getTables: mock(() => Effect.die("getTables not used")),
          listReservations: mock(() => Effect.die("listReservations not used")),
          getProducts: mock(() => Effect.die("getProducts not used")),
          getCategories: mock(() => Effect.die("getCategories not used")),
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({ cancelled: 0, failed: 1 });
    expect(cancelReservation).toHaveBeenCalledWith("dotypos-hold-1");
    expect(markReservationCancelled).toHaveBeenCalledTimes(1);
    expect(order.paymentStatus).toBe("paid");
    expect(order.dotyposReservationStatus).toBe("cancellation_pending");
  });

  test("sweep retries cancellation_pending rows selected by the repository", async () => {
    const cleanup = await import("./reservation-hold-cleanup.service");
    const paymentOrderRepository = await import("./payment-order.repository");
    const pendingOrder = makeOrder({
      dotyposReservationStatus: "cancellation_pending",
      reservationCancellationFailureCode: "dotypos_cancel_failed",
      reservationCancellationFailureMessage: "network",
    });
    const cancelReservation = mock(() => Effect.void);

    const result = await Effect.gen(function* () {
      const service = yield* cleanup.ReservationHoldCleanupService;
      return yield* service.sweepExpiredHolds({
        now: new Date("2026-06-01T10:05:00.000Z"),
        limit: 10,
      });
    }).pipe(
      Effect.provide(cleanup.ReservationHoldCleanupServiceLive),
      Effect.provide(
        Layer.succeed(paymentOrderRepository.PaymentOrderRepository, {
          create: mock(() => Effect.die("create not used")),
          findByReservationSubmitKey: mock(() => Effect.succeed(null)),
          mergeLegalEvidence: mock(() =>
            Effect.die("mergeLegalEvidence not used")
          ),
          updateCheckoutDetails: mock(() =>
            Effect.die("updateCheckoutDetails not used")
          ),
          deleteUnassociatedCreated: mock(() => Effect.void),
          attachNexiSession: mock(() => Effect.void),
          claimNexiSessionCreation: mock(() => Effect.succeed(false)),
          findById: mock(() => Effect.succeed(pendingOrder)),
          markPaymentPending: mock(() => Effect.void),
          resetUnsuccessfulForRetry: mock(() =>
            Effect.die("resetUnsuccessfulForRetry not used")
          ),
          markPaid: mock(() => Effect.void),
          markFailed: mock(() => Effect.void),
          markCancelled: mock(() => Effect.void),
          markExpired: mock(() => Effect.void),
          markUnsuccessfulTerminal: mock(() => Effect.void),
          attachDotyposReservation: mock(() => Effect.void),
          claimReservationCreation: mock(() => Effect.succeed(false)),
          releaseReservationCreation: mock(() => Effect.void),
          attachNewReservationHold: mock(() => Effect.void),
          markReservationAttachCancellationPending: mock(() => Effect.void),
          claimReservationCancellation: mock(() => Effect.succeed(pendingOrder)),
          markReservationCancelled: mock(() => Effect.void),
          markReservationCancellationFailed: mock(() => Effect.void),
          markReservationConfirmed: mock(() => Effect.void),
          selectExpiredReservationHolds: mock(() => Effect.succeed([pendingOrder])),
          claimPaidFulfillment: mock(() => Effect.succeed(null)),
          markCustomerAccessEmailSent: mock(() => Effect.succeed(false)),
          markInternalNotificationSent: mock(() => Effect.succeed(false)),
          markFulfilled: mock(() => Effect.succeed(false)),
          markFulfillmentFailed: mock(() => Effect.void),
        })
      ),
      Effect.provide(
        Layer.succeed(DotyposService, {
          createReservation: mock(() => Effect.die("createReservation not used")),
          cancelReservation,
          confirmReservation: mock(() => Effect.die("confirmReservation not used")),
          getReservation: mock(() => Effect.die("getReservation not used")),
          getCustomer: mock(() => Effect.die("getCustomer not used")),
          findCustomer: mock(() => Effect.die("findCustomer not used")),
          findOrCreateCustomer: mock(() =>
            Effect.die("findOrCreateCustomer not used")
          ),
          getCustomerDiscount: mock(() =>
            Effect.die("getCustomerDiscount not used")
          ),
          getTables: mock(() => Effect.die("getTables not used")),
          listReservations: mock(() => Effect.die("listReservations not used")),
          getProducts: mock(() => Effect.die("getProducts not used")),
          getCategories: mock(() => Effect.die("getCategories not used")),
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({ cancelled: 1, failed: 0 });
    expect(cancelReservation).toHaveBeenCalledWith("dotypos-hold-1");
  });

});
