import { describe, expect, mock, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposCustomerIdSchema,
  DotyposProductIdSchema,
  DotyposReservationIdSchema,
  DotyposService,
} from "@deskohub/dotypos";
import {
  EmailConfigTag,
  EmailDeliveryIdSchema,
  EmailServiceTag,
} from "@deskohub/email";
import { NexiCorrelationIdSchema } from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import type {
  MobileShopPurchaseOrderItemRow,
  MobileShopPurchaseOrderRow,
} from "@/db/schema/mobile-shop-purchases";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  mobileShopCheckoutAttemptKeySchema,
  mobileShopPublicReferenceSchema,
  mobileShopPurchaseIdSchema,
} from "../contracts";
import { MobileShopPurchaseLifecycleRepository } from "./purchase-lifecycle.repository";
import { MobileShopReceiptService } from "./receipt.service";

const purchaseId = mobileShopPurchaseIdSchema.make("purchase-1");
const customerId = DotyposCustomerIdSchema.make("customer-1");
const now = Temporal.Instant.from("2026-08-11T12:00:00Z");
const order: MobileShopPurchaseOrderRow = {
  id: purchaseId,
  publicReference: mobileShopPublicReferenceSchema.make("DW-ABC123"),
  correlationId: NexiCorrelationIdSchema.make("correlation-1"),
  dotyposCustomerId: customerId,
  authorizingDotyposReservationId:
    DotyposReservationIdSchema.make("reservation-1"),
  checkoutAttemptKey: mobileShopCheckoutAttemptKeySchema.make("checkout-1"),
  cartFingerprint: "cart-1",
  quoteFingerprint: "quote-1",
  paymentState: "paid",
  receiptState: "not_started",
  stockState: "not_started",
  stockRetryAllowed: false,
  activePaymentAttemptId: null,
  totalValue: 5000,
  totalExponent: 2,
  currency: "CZK",
  locale: "en-US",
  taxRegime: {
    kind: "not-vat-payer",
    version: "not-vat-v1",
    effectiveFrom: plainDateStringSchema.make("2026-01-01"),
  },
  paidAt: now,
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
const item: MobileShopPurchaseOrderItemRow = {
  id: "item-1",
  purchaseOrderId: purchaseId,
  dotyposProductId: DotyposProductIdSchema.make("water"),
  dotyposCategoryId: DotyposCategoryIdSchema.make("drinks"),
  productVersion: "water-v1",
  canonicalName: "Water",
  displayName: "Water",
  locale: "en-US",
  quantity: 2,
  unitLabel: null,
  unitPriceValue: 2500,
  lineTotalValue: 5000,
  amountExponent: 2,
  currency: "CZK",
  tax: { kind: "not-applicable" },
  createdAt: now,
};

const runReceipt = (
  claim: (typeof MobileShopPurchaseLifecycleRepository.Service)["claimReceipt"]
) => {
  const send = mock(() =>
    Effect.succeed({
      id: EmailDeliveryIdSchema.make("email-1"),
      status: "sent" as const,
      provider: "test",
      timestamp: new Date(),
    })
  );
  const getCustomer = mock(() =>
    Effect.succeed({
      id: customerId,
      _cloudId: "cloud-1",
      email: "customer@example.test",
      points: null,
      flags: "0",
      display: true,
      deleted: false,
    })
  );
  const markReceiptSent = mock(() => Effect.void);
  const serviceLayer = MobileShopReceiptService.Live.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(MobileShopPurchaseLifecycleRepository, {
          claimReceipt: claim,
          markReceiptSent,
          markReceiptFailed: () => Effect.void,
        }),
        Layer.mock(DotyposService, { getCustomer }),
        Layer.mock(EmailServiceTag, { send }),
        Layer.succeed(EmailConfigTag, {
          provider: "console",
          defaultFrom: {
            email: "reservations@workspace.deskohub.cz",
            name: "Deskohub Workspace",
          },
        })
      )
    )
  );
  return {
    result: Effect.runPromise(
      Effect.gen(function* () {
        const receipts = yield* MobileShopReceiptService;
        yield* receipts.deliverPaidReceipt({ purchaseId });
      }).pipe(Effect.provide(serviceLayer))
    ),
    send,
    getCustomer,
    markReceiptSent,
  };
};

describe("mobile shop receipt delivery", () => {
  test("does nothing until the durable paid-only receipt claim succeeds", async () => {
    const harness = runReceipt(() => Effect.succeed(null));
    await harness.result;
    expect(harness.getCustomer).not.toHaveBeenCalled();
    expect(harness.send).not.toHaveBeenCalled();
  });

  test("sends an idempotent email receipt without a PDF after the paid claim", async () => {
    const harness = runReceipt(() => Effect.succeed({ order, items: [item] }));
    await harness.result;

    expect(harness.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: { email: "customer@example.test" },
        tags: ["mobile-shop-receipt"],
        metadata: expect.objectContaining({
          workspaceReservationId: purchaseId,
        }),
      })
    );
    const [message] = harness.send.mock.calls[0] ?? [];
    expect(message).not.toHaveProperty("attachments");
    expect(harness.markReceiptSent).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseId,
        providerMessageId: "email-1",
      })
    );
  });
});
