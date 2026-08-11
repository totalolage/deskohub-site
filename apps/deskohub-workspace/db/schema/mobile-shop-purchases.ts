import type {
  DotyposCategoryId,
  DotyposCustomerId,
  DotyposProductId,
  DotyposReservationId,
  DotyposWarehouseId,
} from "@deskohub/dotypos";
import type {
  NexiCorrelationId,
  NexiOperationId,
  NexiOrderId,
  NexiWebhookEventId,
} from "@deskohub/nexi";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  MobileShopCheckoutAttemptKey,
  MobileShopLineTax,
  MobileShopLocale,
  MobileShopPaymentAttemptId,
  MobileShopPaymentAttemptState,
  MobileShopPaymentState,
  MobileShopPublicReference,
  MobileShopPurchaseId,
  MobileShopReceiptState,
  MobileShopStockState,
  SellerTaxRegime,
} from "@/features/mobile-shop/contracts";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { quotedSqlList } from "./sql-list";

export const mobileShopPurchasePaymentStates = [
  "not_started",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
] as const satisfies readonly MobileShopPaymentState[];

export const mobileShopPurchaseReceiptStates = [
  "not_started",
  "processing",
  "sent",
  "failed",
] as const satisfies readonly MobileShopReceiptState[];

export const mobileShopPurchaseStockStates = [
  "not_started",
  "processing",
  "synced",
  "ambiguous",
  "failed",
] as const satisfies readonly MobileShopStockState[];

export const mobileShopPurchasePaymentAttemptStates = [
  "created",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
] as const satisfies readonly MobileShopPaymentAttemptState[];

const terminalFailurePaymentStates = [
  "failed",
  "cancelled",
  "expired",
] as const satisfies readonly MobileShopPaymentState[];

const terminalFailureAttemptStates = [
  "failed",
  "cancelled",
  "expired",
] as const satisfies readonly MobileShopPaymentAttemptState[];

export const mobileShopPurchaseOrders = pgTable(
  "mobile_shop_purchase_orders",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<MobileShopPurchaseId>(),
    publicReference: text("public_reference")
      .notNull()
      .unique()
      .$type<MobileShopPublicReference>(),
    correlationId: text("correlation_id")
      .notNull()
      .unique()
      .default(postgresUuidV7)
      .$type<NexiCorrelationId>(),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    authorizingDotyposReservationId: text("authorizing_dotypos_reservation_id")
      .notNull()
      .$type<DotyposReservationId>(),
    checkoutAttemptKey: text("checkout_attempt_key")
      .notNull()
      .unique()
      .$type<MobileShopCheckoutAttemptKey>(),
    cartFingerprint: text("cart_fingerprint").notNull(),
    quoteFingerprint: text("quote_fingerprint").notNull(),
    paymentState: text("payment_state")
      .notNull()
      .$type<MobileShopPaymentState>(),
    receiptState: text("receipt_state")
      .notNull()
      .$type<MobileShopReceiptState>(),
    stockState: text("stock_state").notNull().$type<MobileShopStockState>(),
    stockRetryAllowed: boolean("stock_retry_allowed").notNull().default(false),
    activePaymentAttemptId: text(
      "active_payment_attempt_id"
    ).$type<MobileShopPaymentAttemptId>(),
    totalValue: integer("total_value").notNull(),
    totalExponent: integer("total_exponent").notNull(),
    currency: text("currency").notNull(),
    locale: text("locale").notNull().$type<MobileShopLocale>(),
    taxRegime: jsonb("tax_regime").notNull().$type<SellerTaxRegime>(),
    paidAt: instant("paid_at"),
    failedAt: instant("failed_at"),
    cancelledAt: instant("cancelled_at"),
    expiredAt: instant("expired_at"),
    receiptSentAt: instant("receipt_sent_at"),
    stockSyncedAt: instant("stock_synced_at"),
    paymentFailureCode: text("payment_failure_code"),
    receiptFailureCode: text("receipt_failure_code"),
    stockFailureCode: text("stock_failure_code"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "mobile_shop_purchase_orders_payment_state_check",
      sql`${t.paymentState} in (${quotedSqlList(mobileShopPurchasePaymentStates)})`
    ),
    check(
      "mobile_shop_purchase_orders_receipt_state_check",
      sql`${t.receiptState} in (${quotedSqlList(mobileShopPurchaseReceiptStates)})`
    ),
    check(
      "mobile_shop_purchase_orders_stock_state_check",
      sql`${t.stockState} in (${quotedSqlList(mobileShopPurchaseStockStates)})`
    ),
    check(
      "mobile_shop_purchase_orders_amount_check",
      sql`${t.totalValue} > 0 and ${t.totalExponent} >= 0 and ${t.currency} = 'CZK'`
    ),
    check(
      "mobile_shop_purchase_orders_locale_check",
      sql`${t.locale} in ('cs-CZ', 'en-US')`
    ),
    check(
      "mobile_shop_purchase_orders_tax_regime_check",
      sql`${t.taxRegime}->>'kind' in ('not-vat-payer', 'vat-payer') and nullif(${t.taxRegime}->>'version', '') is not null`
    ),
    check(
      "mobile_shop_purchase_orders_paid_at_check",
      sql`${t.paymentState} <> 'paid' or ${t.paidAt} is not null`
    ),
    check(
      "mobile_shop_purchase_orders_payment_failure_check",
      sql`${t.paymentState} not in (${quotedSqlList(terminalFailurePaymentStates)}) or ${t.paymentFailureCode} is not null`
    ),
    check(
      "mobile_shop_purchase_orders_stock_retry_check",
      sql`${t.stockRetryAllowed} = false or (${t.paymentState} = 'paid' and ${t.stockState} = 'failed')`
    ),
    index("mobile_shop_purchase_orders_customer_created_idx").on(
      t.dotyposCustomerId,
      t.createdAt
    ),
    index("mobile_shop_purchase_orders_payment_created_idx").on(
      t.paymentState,
      t.createdAt
    ),
    index("mobile_shop_purchase_orders_stock_updated_idx").on(
      t.stockState,
      t.updatedAt
    ),
  ]
);

export const mobileShopPurchaseOrderItems = pgTable(
  "mobile_shop_purchase_order_items",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    purchaseOrderId: text("purchase_order_id")
      .notNull()
      .$type<MobileShopPurchaseId>()
      .references(() => mobileShopPurchaseOrders.id, { onDelete: "restrict" }),
    dotyposProductId: text("dotypos_product_id")
      .notNull()
      .$type<DotyposProductId>(),
    dotyposCategoryId: text("dotypos_category_id")
      .notNull()
      .$type<DotyposCategoryId>(),
    productVersion: text("product_version").notNull(),
    canonicalName: text("canonical_name").notNull(),
    displayName: text("display_name").notNull(),
    locale: text("locale").notNull().$type<MobileShopLocale>(),
    quantity: integer("quantity").notNull(),
    unitLabel: text("unit_label"),
    unitPriceValue: integer("unit_price_value").notNull(),
    lineTotalValue: integer("line_total_value").notNull(),
    amountExponent: integer("amount_exponent").notNull(),
    currency: text("currency").notNull(),
    tax: jsonb("tax").notNull().$type<MobileShopLineTax>(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "mobile_shop_purchase_order_items_quantity_check",
      sql`${t.quantity} between 1 and 10`
    ),
    check(
      "mobile_shop_purchase_order_items_amount_check",
      sql`${t.unitPriceValue} > 0 and ${t.lineTotalValue} = ${t.unitPriceValue} * ${t.quantity} and ${t.amountExponent} >= 0 and ${t.currency} = 'CZK'`
    ),
    check(
      "mobile_shop_purchase_order_items_locale_check",
      sql`${t.locale} in ('cs-CZ', 'en-US')`
    ),
    uniqueIndex("mobile_shop_purchase_order_items_product_unique_idx").on(
      t.purchaseOrderId,
      t.dotyposProductId
    ),
    index("mobile_shop_purchase_order_items_order_idx").on(t.purchaseOrderId),
  ]
);

export const mobileShopPurchasePaymentAttempts = pgTable(
  "mobile_shop_purchase_payment_attempts",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<MobileShopPaymentAttemptId>(),
    purchaseOrderId: text("purchase_order_id")
      .notNull()
      .$type<MobileShopPurchaseId>()
      .references(() => mobileShopPurchaseOrders.id, { onDelete: "restrict" }),
    providerOrderId: text("provider_order_id").$type<NexiOrderId>(),
    securityToken: text("security_token"),
    providerRedirectUrl: text("provider_redirect_url"),
    state: text("state").notNull().$type<MobileShopPaymentAttemptState>(),
    amountValue: integer("amount_value").notNull(),
    amountExponent: integer("amount_exponent").notNull(),
    currency: text("currency").notNull(),
    lastWebhookEventId: text(
      "last_webhook_event_id"
    ).$type<NexiWebhookEventId>(),
    lastProviderOperationId: text(
      "last_provider_operation_id"
    ).$type<NexiOperationId>(),
    lastProviderStatus: text("last_provider_status"),
    failureCode: text("failure_code"),
    providerOrderCreatedAt: instant("provider_order_created_at"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "mobile_shop_purchase_payment_attempts_state_check",
      sql`${t.state} in (${quotedSqlList(mobileShopPurchasePaymentAttemptStates)})`
    ),
    check(
      "mobile_shop_purchase_payment_attempts_amount_check",
      sql`${t.amountValue} > 0 and ${t.amountExponent} >= 0 and ${t.currency} = 'CZK'`
    ),
    check(
      "mobile_shop_purchase_payment_attempts_failure_check",
      sql`${t.state} not in (${quotedSqlList(terminalFailureAttemptStates)}) or ${t.failureCode} is not null`
    ),
    uniqueIndex(
      "mobile_shop_purchase_payment_attempts_provider_order_unique_idx"
    )
      .on(t.providerOrderId)
      .where(sql`${t.providerOrderId} is not null`),
    index("mobile_shop_purchase_payment_attempts_order_idx").on(
      t.purchaseOrderId,
      t.createdAt
    ),
    index("mobile_shop_purchase_payment_attempts_state_idx").on(
      t.state,
      t.createdAt
    ),
  ]
);

export const mobileShopPurchaseWebhookEvents = pgTable(
  "mobile_shop_purchase_webhook_events",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    providerEventId: text("provider_event_id")
      .notNull()
      .unique()
      .$type<NexiWebhookEventId>(),
    purchaseOrderId: text("purchase_order_id")
      .$type<MobileShopPurchaseId>()
      .references(() => mobileShopPurchaseOrders.id, { onDelete: "restrict" }),
    paymentAttemptId: text("payment_attempt_id")
      .$type<MobileShopPaymentAttemptId>()
      .references(() => mobileShopPurchasePaymentAttempts.id, {
        onDelete: "restrict",
      }),
    state: text("state")
      .notNull()
      .$type<"received" | "processing" | "processed" | "failed">(),
    resultCode: text("result_code"),
    receivedAt: instant("received_at").notNull().default(sql`now()`),
    processedAt: instant("processed_at"),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "mobile_shop_purchase_webhook_events_state_check",
      sql`${t.state} in ('received', 'processing', 'processed', 'failed')`
    ),
    index("mobile_shop_purchase_webhook_events_state_idx").on(
      t.state,
      t.receivedAt
    ),
  ]
);

export const mobileShopPurchaseReceiptDeliveries = pgTable(
  "mobile_shop_purchase_receipt_deliveries",
  {
    purchaseOrderId: text("purchase_order_id")
      .primaryKey()
      .$type<MobileShopPurchaseId>()
      .references(() => mobileShopPurchaseOrders.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    providerMessageId: text("provider_message_id").unique(),
    state: text("state").notNull().$type<MobileShopReceiptState>(),
    resultCode: text("result_code"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: instant("last_attempt_at"),
    sentAt: instant("sent_at"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "mobile_shop_purchase_receipt_deliveries_state_check",
      sql`${t.state} in (${quotedSqlList(mobileShopPurchaseReceiptStates)})`
    ),
    check(
      "mobile_shop_purchase_receipt_deliveries_attempt_count_check",
      sql`${t.attemptCount} >= 0`
    ),
    index("mobile_shop_purchase_receipt_deliveries_state_idx").on(
      t.state,
      t.updatedAt
    ),
  ]
);

export const mobileShopPurchaseStockAttempts = pgTable(
  "mobile_shop_purchase_stock_attempts",
  {
    purchaseOrderId: text("purchase_order_id")
      .primaryKey()
      .$type<MobileShopPurchaseId>()
      .references(() => mobileShopPurchaseOrders.id, { onDelete: "restrict" }),
    warehouseId: text("warehouse_id").$type<DotyposWarehouseId>(),
    providerReference: text("provider_reference").unique(),
    state: text("state").notNull().$type<MobileShopStockState>(),
    resultCode: text("result_code"),
    retryAllowed: boolean("retry_allowed").notNull().default(false),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: instant("last_attempt_at"),
    syncedAt: instant("synced_at"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "mobile_shop_purchase_stock_attempts_state_check",
      sql`${t.state} in (${quotedSqlList(mobileShopPurchaseStockStates)})`
    ),
    check(
      "mobile_shop_purchase_stock_attempts_attempt_count_check",
      sql`${t.attemptCount} >= 0`
    ),
    check(
      "mobile_shop_purchase_stock_attempts_retry_check",
      sql`${t.retryAllowed} = false or ${t.state} = 'failed'`
    ),
    check(
      "mobile_shop_purchase_stock_attempts_synced_warehouse_check",
      sql`${t.state} <> 'synced' or ${t.warehouseId} is not null`
    ),
    index("mobile_shop_purchase_stock_attempts_state_idx").on(
      t.state,
      t.updatedAt
    ),
  ]
);

export type MobileShopPurchaseOrderRow =
  typeof mobileShopPurchaseOrders.$inferSelect;
export type NewMobileShopPurchaseOrderRow =
  typeof mobileShopPurchaseOrders.$inferInsert;
export type MobileShopPurchaseOrderItemRow =
  typeof mobileShopPurchaseOrderItems.$inferSelect;
export type NewMobileShopPurchaseOrderItemRow =
  typeof mobileShopPurchaseOrderItems.$inferInsert;
export type MobileShopPurchasePaymentAttemptRow =
  typeof mobileShopPurchasePaymentAttempts.$inferSelect;
