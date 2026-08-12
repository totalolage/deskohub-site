import {
  DotyposCategoryIdSchema,
  DotyposProductIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Schema } from "effect";
import {
  positiveWorkspaceMoneyCodec,
  workspaceMoneyCodec,
} from "@/features/checkout/workspace-money";
import {
  instantStringSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";

const opaqueId = <const Name extends string>(name: Name, description: string) =>
  Schema.Trim.check(Schema.isNonEmpty()).pipe(Schema.brand(name)).annotate({
    identifier: name,
    description,
  });

export const mobileShopPurchaseIdSchema = opaqueId(
  "MobileShopPurchaseId",
  "Opaque identifier for a self-service purchase."
);
export type MobileShopPurchaseId = typeof mobileShopPurchaseIdSchema.Type;

export interface MobileShopHistoryCursor {
  readonly createdAt: Temporal.Instant;
  readonly id: MobileShopPurchaseId;
}

export const mobileShopPaymentAttemptIdSchema = opaqueId(
  "MobileShopPaymentAttemptId",
  "Opaque identifier for a self-service purchase payment attempt."
);
export type MobileShopPaymentAttemptId =
  typeof mobileShopPaymentAttemptIdSchema.Type;

export const mobileShopCheckoutAttemptIdSchema = opaqueId(
  "MobileShopCheckoutAttemptId",
  "Client-generated UUID identifying one intentional checkout submission."
);
export type MobileShopCheckoutAttemptId =
  typeof mobileShopCheckoutAttemptIdSchema.Type;

export const mobileShopCheckoutAttemptKeySchema = opaqueId(
  "MobileShopCheckoutAttemptKey",
  "Server-derived key binding a checkout attempt to its commerce owner."
);
export type MobileShopCheckoutAttemptKey =
  typeof mobileShopCheckoutAttemptKeySchema.Type;

export const mobileShopPublicReferenceSchema = opaqueId(
  "MobileShopPublicReference",
  "Non-secret purchase reference suitable for customer support."
);
export type MobileShopPublicReference =
  typeof mobileShopPublicReferenceSchema.Type;

export const mobileShopLocaleSchema = Schema.Literals(["cs-CZ", "en-US"]);
export type MobileShopLocale = typeof mobileShopLocaleSchema.Type;

export const mobileShopPaymentStates = [
  "not_started",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
] as const;
export const mobileShopPaymentStateSchema = Schema.Literals(
  mobileShopPaymentStates
);
export type MobileShopPaymentState = typeof mobileShopPaymentStateSchema.Type;

export const mobileShopPaymentAttemptStates = [
  "created",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
] as const;
export const mobileShopPaymentAttemptStateSchema = Schema.Literals(
  mobileShopPaymentAttemptStates
);
export type MobileShopPaymentAttemptState =
  typeof mobileShopPaymentAttemptStateSchema.Type;

export const mobileShopReceiptStates = [
  "not_started",
  "processing",
  "sent",
  "failed",
] as const;
export const mobileShopReceiptStateSchema = Schema.Literals(
  mobileShopReceiptStates
);
export type MobileShopReceiptState = typeof mobileShopReceiptStateSchema.Type;

export const mobileShopStockStates = [
  "not_started",
  "processing",
  "synced",
  "ambiguous",
  "failed",
] as const;
export const mobileShopStockStateSchema = Schema.Literals(
  mobileShopStockStates
);
export type MobileShopStockState = typeof mobileShopStockStateSchema.Type;

export const notVatPayerTaxRegimeSchema = Schema.Struct({
  kind: Schema.Literal("not-vat-payer"),
  version: Schema.NonEmptyString,
  effectiveFrom: plainDateStringSchema,
});

export const vatPayerTaxRegimeSchema = Schema.Struct({
  kind: Schema.Literal("vat-payer"),
  version: Schema.NonEmptyString,
  effectiveFrom: plainDateStringSchema,
  vatId: Schema.NonEmptyString,
});

export const sellerTaxRegimeSchema = Schema.Union([
  notVatPayerTaxRegimeSchema,
  vatPayerTaxRegimeSchema,
]);
export type SellerTaxRegime = typeof sellerTaxRegimeSchema.Type;

export const mobileShopLineTaxSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("not-applicable") }),
  Schema.Struct({
    kind: Schema.Literal("vat"),
    rateBasisPoints: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    netAmount: workspaceMoneyCodec,
    taxAmount: workspaceMoneyCodec,
    finalAmount: positiveWorkspaceMoneyCodec,
  }),
]);
export type MobileShopLineTax = typeof mobileShopLineTaxSchema.Type;

export const mobileShopCatalogCategorySchema = Schema.Struct({
  id: DotyposCategoryIdSchema,
  name: Schema.NonEmptyString,
  order: Schema.Int,
  color: Schema.optionalKey(Schema.NonEmptyString),
});
export type MobileShopCatalogCategory =
  typeof mobileShopCatalogCategorySchema.Type;

export const mobileShopCatalogProductSchema = Schema.Struct({
  id: DotyposProductIdSchema,
  categoryId: DotyposCategoryIdSchema,
  name: Schema.NonEmptyString,
  canonicalName: Schema.NonEmptyString,
  description: Schema.optionalKey(Schema.NonEmptyString),
  imageUrl: Schema.optionalKey(Schema.NonEmptyString),
  unitLabel: Schema.optionalKey(Schema.NonEmptyString),
  price: positiveWorkspaceMoneyCodec,
  version: Schema.NonEmptyString,
});
export type MobileShopCatalogProduct =
  typeof mobileShopCatalogProductSchema.Type;

export const mobileShopCatalogSchema = Schema.Struct({
  version: Schema.NonEmptyString,
  generatedAt: instantStringSchema,
  categories: Schema.Array(mobileShopCatalogCategorySchema),
  products: Schema.Array(mobileShopCatalogProductSchema),
});
export type MobileShopCatalog = typeof mobileShopCatalogSchema.Type;

export const mobileShopCartLineSchema = Schema.Struct({
  productId: DotyposProductIdSchema,
  quantity: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type MobileShopCartLine = typeof mobileShopCartLineSchema.Type;

export const mobileShopCartSchema = Schema.Array(
  mobileShopCartLineSchema
).check(Schema.isMinLength(1), Schema.isMaxLength(100));
export type MobileShopCart = typeof mobileShopCartSchema.Type;

export const mobileShopQuoteItemSchema = Schema.Struct({
  productId: DotyposProductIdSchema,
  categoryId: DotyposCategoryIdSchema,
  productVersion: Schema.NonEmptyString,
  canonicalName: Schema.NonEmptyString,
  displayName: Schema.NonEmptyString,
  quantity: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  unitLabel: Schema.optionalKey(Schema.NonEmptyString),
  unitPrice: positiveWorkspaceMoneyCodec,
  lineTotal: positiveWorkspaceMoneyCodec,
  tax: mobileShopLineTaxSchema,
});
export type MobileShopQuoteItem = typeof mobileShopQuoteItemSchema.Type;

export const mobileShopQuoteSchema = Schema.Struct({
  fingerprint: Schema.NonEmptyString,
  expiresAt: instantStringSchema,
  locale: mobileShopLocaleSchema,
  taxRegime: sellerTaxRegimeSchema,
  items: Schema.Array(mobileShopQuoteItemSchema).check(Schema.isMinLength(1)),
  total: positiveWorkspaceMoneyCodec,
});
export type MobileShopQuote = typeof mobileShopQuoteSchema.Type;

export const mobileShopQuoteRequestSchema = Schema.Struct({
  locale: mobileShopLocaleSchema,
  cart: mobileShopCartSchema,
});
export type MobileShopQuoteRequest = typeof mobileShopQuoteRequestSchema.Type;

export const mobileShopCreateOrderRequestSchema = Schema.Struct({
  checkoutAttemptId: mobileShopCheckoutAttemptIdSchema,
  quoteFingerprint: Schema.NonEmptyString,
  quoteExpiresAt: instantStringSchema,
  locale: mobileShopLocaleSchema,
  cart: mobileShopCartSchema,
});
export type MobileShopCreateOrderRequest =
  typeof mobileShopCreateOrderRequestSchema.Type;

export const mobileShopOrderItemSchema = Schema.Struct({
  productId: DotyposProductIdSchema,
  displayName: Schema.NonEmptyString,
  quantity: Schema.Int.check(Schema.isGreaterThan(0)),
  unitPrice: positiveWorkspaceMoneyCodec,
  lineTotal: positiveWorkspaceMoneyCodec,
  unitLabel: Schema.optionalKey(Schema.NonEmptyString),
  tax: mobileShopLineTaxSchema,
});

export const mobileShopOrderSummarySchema = Schema.Struct({
  id: mobileShopPurchaseIdSchema,
  publicReference: mobileShopPublicReferenceSchema,
  createdAt: instantStringSchema,
  paymentState: mobileShopPaymentStateSchema,
  receiptState: mobileShopReceiptStateSchema,
  locale: mobileShopLocaleSchema,
  taxRegime: sellerTaxRegimeSchema,
  total: positiveWorkspaceMoneyCodec,
  items: Schema.Array(mobileShopOrderItemSchema),
});
export type MobileShopOrderSummary = typeof mobileShopOrderSummarySchema.Type;

export const mobileShopOrderHistorySchema = Schema.Struct({
  orders: Schema.Array(mobileShopOrderSummarySchema),
  nextCursor: Schema.optionalKey(Schema.NonEmptyString),
});
export type MobileShopOrderHistory = typeof mobileShopOrderHistorySchema.Type;

export const mobileShopAccountSchema = Schema.Struct({
  authenticated: Schema.Literal(true),
  webMutation: Schema.Struct({
    headerName: Schema.Literal("x-deskohub-csrf"),
    headerValue: Schema.Literal("1"),
  }),
  commerceIdentity: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("linked") }),
    Schema.Struct({ kind: Schema.Literal("unavailable") }),
  ]),
  entitlement: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("eligible"),
      day: plainDateStringSchema,
      reservationId: DotyposReservationIdSchema,
      validUntil: instantStringSchema,
    }),
    Schema.Struct({
      kind: Schema.Literal("locked"),
      reason: Schema.Literals([
        "commerce_identity_unavailable",
        "no_active_reservation",
      ]),
    }),
  ]),
});
export type MobileShopAccount = typeof mobileShopAccountSchema.Type;

export const mobileShopPaymentSessionSchema = Schema.Struct({
  orderId: mobileShopPurchaseIdSchema,
  hostedPageUrl: Schema.NonEmptyString,
});
export type MobileShopPaymentSession =
  typeof mobileShopPaymentSessionSchema.Type;

export const mobileShopErrorCodes = [
  "unauthorized",
  "commerce_identity_unavailable",
  "no_active_reservation",
  "catalog_unavailable",
  "invalid_cart",
  "quantity_limit_exceeded",
  "catalog_changed",
  "idempotency_conflict",
  "payment_pending",
  "payment_unavailable",
  "order_not_found",
  "order_not_owned",
  "service_unavailable",
] as const;
export const mobileShopErrorCodeSchema = Schema.Literals(mobileShopErrorCodes);
export type MobileShopErrorCode = typeof mobileShopErrorCodeSchema.Type;

export type MobileShopApiSuccess<A> = {
  readonly ok: true;
  readonly data: A;
};

export type MobileShopApiFailure = {
  readonly ok: false;
  readonly error: {
    readonly code: MobileShopErrorCode;
  };
};

export type MobileShopApiEnvelope<A> =
  | MobileShopApiSuccess<A>
  | MobileShopApiFailure;
