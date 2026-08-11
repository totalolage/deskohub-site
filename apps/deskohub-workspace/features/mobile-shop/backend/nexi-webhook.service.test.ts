import { describe, expect, mock, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import {
  NexiCorrelationIdSchema,
  NexiOperationIdSchema,
  NexiOrderIdSchema,
  NexiService,
  NexiWebhookEventIdSchema,
  type PaymentVerificationResult,
} from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import type {
  MobileShopPurchaseOrderRow,
  MobileShopPurchasePaymentAttemptRow,
} from "@/db/schema/mobile-shop-purchases";
import { getNexiCurrencyOverride } from "@/features/checkout/backend/payment/nexi-currency";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import {
  mobileShopCheckoutAttemptKeySchema,
  mobileShopPaymentAttemptIdSchema,
  mobileShopPublicReferenceSchema,
  mobileShopPurchaseIdSchema,
} from "../contracts";
import { MobileShopNexiWebhookService } from "./nexi-webhook.service";
import { MobileShopPaidFulfillmentService } from "./paid-fulfillment.service";
import {
  type MobileShopPaymentRecord,
  MobileShopPurchaseLifecycleRepository,
} from "./purchase-lifecycle.repository";

const purchaseId = mobileShopPurchaseIdSchema.make("purchase-1");
const attemptId = mobileShopPaymentAttemptIdSchema.make("attempt-1");
const providerOrderId = NexiOrderIdSchema.make("provider-order-1");
const eventId = NexiWebhookEventIdSchema.make("event-1");
const operationId = NexiOperationIdSchema.make("operation-1");
const now = Temporal.Instant.from("2026-08-11T12:00:00Z");

const order: MobileShopPurchaseOrderRow = {
  id: purchaseId,
  publicReference: mobileShopPublicReferenceSchema.make("DW-ABC123"),
  correlationId: NexiCorrelationIdSchema.make("correlation-1"),
  dotyposCustomerId: DotyposCustomerIdSchema.make("customer-1"),
  authorizingDotyposReservationId:
    DotyposReservationIdSchema.make("reservation-1"),
  checkoutAttemptKey: mobileShopCheckoutAttemptKeySchema.make("checkout-1"),
  cartFingerprint: "cart-1",
  quoteFingerprint: "quote-1",
  paymentState: "pending",
  receiptState: "not_started",
  stockState: "not_started",
  stockRetryAllowed: false,
  activePaymentAttemptId: attemptId,
  totalValue: 5000,
  totalExponent: 2,
  currency: "CZK",
  locale: "en-US",
  taxRegime: {
    kind: "not-vat-payer",
    version: "not-vat-v1",
    effectiveFrom: "2026-01-01" as never,
  },
  paidAt: null,
  failedAt: null,
  cancelledAt: null,
  expiredAt: null,
  receiptSentAt: null,
  stockSyncedAt: null,
  paymentFailureCode: null,
  receiptFailureCode: null,
  stockFailureCode: null,
  createdAt: now,
  updatedAt: now,
};

const attempt: MobileShopPurchasePaymentAttemptRow = {
  id: attemptId,
  purchaseOrderId: purchaseId,
  providerOrderId,
  securityToken: "security-token",
  providerRedirectUrl: "https://pay.example/hosted",
  state: "pending",
  amountValue: 5000,
  amountExponent: 2,
  currency: "CZK",
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  providerOrderCreatedAt: now,
  createdAt: now,
  updatedAt: now,
};

const payment: MobileShopPaymentRecord = { order, attempt };

const verification: PaymentVerificationResult = {
  status: "success",
  provider: {
    orderId: providerOrderId,
    operationId,
    amount: "5000",
    currency: "CZK",
    orderStatus: "EXECUTED",
    captureExecuted: true,
  },
  mismatches: [],
};

const payload = {
  eventId,
  securityToken: "security-token",
  operation: {
    orderId: providerOrderId,
    operationId,
    operationResult: "EXECUTED",
  },
};

const runWebhook = (
  overrides: {
    readonly claimWebhook?: ReturnType<typeof mock>;
    readonly verifyPaymentOutcome?: ReturnType<typeof mock>;
    readonly markPaid?: ReturnType<typeof mock>;
    readonly markWebhookFailed?: ReturnType<typeof mock>;
    readonly fulfillPaidPurchase?: ReturnType<typeof mock>;
  } = {}
) => {
  const claimWebhook =
    overrides.claimWebhook ??
    mock(() => Effect.succeed({ kind: "claimed" as const }));
  const verifyPaymentOutcome =
    overrides.verifyPaymentOutcome ?? mock(() => Effect.succeed(verification));
  const markPaid =
    overrides.markPaid ??
    mock(() =>
      Effect.succeed({
        changed: true,
        additionalPayment: false,
        payment: {
          order: { ...order, paymentState: "paid" as const, paidAt: now },
          attempt: { ...attempt, state: "paid" as const },
        },
        timestamp: now,
      })
    );
  const markWebhookProcessed = mock(() => Effect.void);
  const markWebhookFailed =
    overrides.markWebhookFailed ?? mock(() => Effect.void);
  const fulfillPaidPurchase =
    overrides.fulfillPaidPurchase ?? mock(() => Effect.void);
  const capture = mock(() => Effect.void);

  const repository = Layer.mock(MobileShopPurchaseLifecycleRepository, {
    claimWebhook,
    findPaymentByProviderOrderId: () => Effect.succeed(payment),
    markPaid,
    markTerminal: () => Effect.die("not used"),
    markWebhookProcessed,
    markWebhookFailed,
  });
  const layer = MobileShopNexiWebhookService.Live.pipe(
    Layer.provide(
      Layer.mergeAll(
        repository,
        Layer.mock(NexiService, { verifyPaymentOutcome }),
        Layer.mock(MobileShopPaidFulfillmentService, {
          fulfillPaidPurchase,
        }),
        Layer.mock(PostHogEventService, { capture })
      )
    )
  );

  return {
    result: Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* MobileShopNexiWebhookService;
        return yield* service.processNotification(payload);
      }).pipe(Effect.provide(layer))
    ),
    claimWebhook,
    verifyPaymentOutcome,
    markPaid,
    markWebhookProcessed,
    markWebhookFailed,
    fulfillPaidPurchase,
    capture,
  };
};

describe("mobile shop Nexi webhook", () => {
  test("marks a verified payment paid once and starts paid-only fulfillment", async () => {
    const harness = runWebhook();
    await expect(harness.result).resolves.toEqual({
      status: "accepted",
      eventId,
      orderId: providerOrderId,
    });

    expect(harness.verifyPaymentOutcome).toHaveBeenCalledWith({
      orderId: providerOrderId,
      correlationId: order.correlationId,
      amount: "5000",
      currency: getNexiCurrencyOverride() ?? "CZK",
      securityToken: "security-token",
    });
    expect(harness.markPaid).toHaveBeenCalledTimes(1);
    expect(harness.fulfillPaidPurchase).toHaveBeenCalledWith({ purchaseId });
    expect(harness.markWebhookProcessed).toHaveBeenCalledTimes(1);
    expect(harness.capture).toHaveBeenCalledTimes(1);
  });

  test("does not verify or fulfill a duplicate delivery", async () => {
    const harness = runWebhook({
      claimWebhook: mock(() => Effect.succeed({ kind: "duplicate" as const })),
    });
    await expect(harness.result).resolves.toMatchObject({
      status: "duplicate",
    });
    expect(harness.verifyPaymentOutcome).not.toHaveBeenCalled();
    expect(harness.markPaid).not.toHaveBeenCalled();
    expect(harness.fulfillPaidPurchase).not.toHaveBeenCalled();
  });

  test("recovers fulfillment without emitting a second paid transition", async () => {
    const markPaid = mock(() =>
      Effect.succeed({
        changed: false,
        additionalPayment: false,
        payment: {
          order: { ...order, paymentState: "paid" as const, paidAt: now },
          attempt: { ...attempt, state: "paid" as const },
        },
        timestamp: now,
      })
    );
    const harness = runWebhook({ markPaid });
    await expect(harness.result).resolves.toMatchObject({ status: "accepted" });
    expect(markPaid).toHaveBeenCalledTimes(1);
    expect(harness.capture).not.toHaveBeenCalled();
    expect(harness.fulfillPaidPurchase).toHaveBeenCalledTimes(1);
  });

  test("acknowledges a verification mismatch without changing payment state", async () => {
    const harness = runWebhook({
      verifyPaymentOutcome: mock(() =>
        Effect.succeed({ ...verification, mismatches: ["amount"] as const })
      ),
    });
    await expect(harness.result).rejects.toMatchObject({
      code: "mobile_shop_nexi_verification_mismatch",
      retryProvider: false,
    });
    expect(harness.markPaid).not.toHaveBeenCalled();
    expect(harness.markWebhookFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId,
        purchaseId,
        paymentAttemptId: attemptId,
      })
    );
    expect(harness.fulfillPaidPurchase).not.toHaveBeenCalled();
  });
});
