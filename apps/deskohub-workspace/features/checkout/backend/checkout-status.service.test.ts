import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { NexiService } from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import { checkoutDetailsJsonSchema } from "@/features/checkout/schemas/checkout-details";
import { CheckoutStatusService, CheckoutStatusServiceLive } from "./checkout-status.service";
import { PaymentOrderRepository } from "./payment-order.repository";
import { ReservationHoldCleanupService } from "./reservation-hold-cleanup.service";

type PaymentOrderTestRepository = typeof PaymentOrderRepository.Service;
type NexiTestService = typeof NexiService.Service;

const reservation = {
  entryTier: "basic" as const,
  date: "2099-06-10",
  coffee: false,
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420777123456",
};

const makeOrder = (overrides: Record<string, unknown> = {}) => {
  const quote = buildWorkspaceCheckoutQuote(reservation);

  return {
    id: "order-terminal",
    provider: "nexi" as const,
    dotyposCustomerId: "customer",
    correlationId: "correlation",
    checkoutDetails: checkoutDetailsJsonSchema.parse({
      schema: "workspace-checkout-details",
      schemaVersion: 1,
      locale: "en-US",
      reservation: {
        tier: reservation.entryTier,
        date: reservation.date,
        coffee: reservation.coffee,
      },
      payment: {
        expectedPrice: quote.summary.total,
        quoteFingerprint: quote.fingerprint,
        summary: quote.summary,
      },
      legal: {},
      fulfillment: { accessCodePolicy: "workspace-static-v1" },
    }),
    reservationSubmitKey: "submit-key",
    dotyposReservationId: "reservation-new",
    dotyposReservationStatus: "NEW" as const,
    securityToken: "security-token",
    paymentStatus: "payment_pending" as const,
    fulfillmentStatus: "not_started" as const,
    lastWebhookEventId: null,
    lastProviderOperationId: null,
    lastProviderStatus: null,
    failureCode: null,
    paidAt: null,
    reservationCreatedAt: new Date("2026-06-01T10:00:00.000Z"),
    reservationHoldExpiresAt: new Date("2026-06-01T10:10:00.000Z"),
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
    ...overrides,
  };
};

const makePaymentOrders = (order: ReturnType<typeof makeOrder>) => ({
  findById: mock(() => Effect.succeed(order)),
  markCancelled: mock(() => Effect.void),
  create: mock(() => Effect.die("create not mocked")),
  findByReservationSubmitKey: mock(() => Effect.die("findByReservationSubmitKey not mocked")),
  mergeLegalEvidence: mock(() => Effect.die("mergeLegalEvidence not mocked")),
  updateCheckoutDetails: mock(() => Effect.die("updateCheckoutDetails not mocked")),
  deleteUnassociatedCreated: mock(() => Effect.die("deleteUnassociatedCreated not mocked")),
  attachNexiSession: mock(() => Effect.die("attachNexiSession not mocked")),
  claimNexiSessionCreation: mock(() => Effect.die("claimNexiSessionCreation not mocked")),
  markPaymentPending: mock(() => Effect.die("markPaymentPending not mocked")),
  resetUnsuccessfulForRetry: mock(() => Effect.die("resetUnsuccessfulForRetry not mocked")),
  markPaid: mock(() => Effect.die("markPaid not mocked")),
  markFailed: mock(() => Effect.die("markFailed not mocked")),
  markExpired: mock(() => Effect.die("markExpired not mocked")),
  markUnsuccessfulTerminal: mock(() => Effect.die("markUnsuccessfulTerminal not mocked")),
  attachDotyposReservation: mock(() => Effect.die("attachDotyposReservation not mocked")),
  claimReservationCreation: mock(() => Effect.die("claimReservationCreation not mocked")),
  releaseReservationCreation: mock(() => Effect.die("releaseReservationCreation not mocked")),
  attachNewReservationHold: mock(() => Effect.die("attachNewReservationHold not mocked")),
  markReservationAttachCancellationPending: mock(() => Effect.die("markReservationAttachCancellationPending not mocked")),
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
} satisfies PaymentOrderTestRepository);

const makeNexi = (overrides: Partial<NexiTestService> = {}) => ({
  createHostedPaymentPage: mock(() => Effect.die("createHostedPaymentPage not mocked")),
  verifyPaymentOutcome: mock(() => Effect.succeed({ status: "pending" as const })),
  ...overrides,
} satisfies NexiTestService);

describe("CheckoutStatusService", () => {
  test("provider-return cancellation marks payment terminal and cancels active hold", async () => {
    const order = makeOrder();
    const paymentOrders = makePaymentOrders(order);
    const cancelOrderHold = mock(() => Effect.void);
    const nexi = makeNexi({
      verifyPaymentOutcome: mock(() =>
        Effect.succeed({
          status: "failure" as const,
          provider: {
            orderId: order.id,
            amount: "99000",
            currency: "CZK",
            orderStatus: "CANCELED",
            captureExecuted: false,
          },
          mismatches: [],
        })
      ),
    });

    await Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* service.recordProviderReturn({
        orderId: order.id,
        returnOutcome: "cancelled",
      });
    }).pipe(
      Effect.provide(CheckoutStatusServiceLive),
      Effect.provide(Layer.succeed(PaymentOrderRepository, paymentOrders)),
      Effect.provide(Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold,
        sweepExpiredHolds: mock(() => Effect.succeed({ cancelled: 0, failed: 0 })),
      })),
      Effect.provide(Layer.succeed(NexiService, nexi)),
      Effect.runPromise
    );

    expect(paymentOrders.markCancelled).toHaveBeenCalledWith({
      id: order.id,
      failureCode: "nexi_payment_failed",
      providerOperationId: order.id,
      providerStatus: "CANCELED",
    });
    expect(cancelOrderHold).toHaveBeenCalledWith({ orderId: order.id });
  });
});
