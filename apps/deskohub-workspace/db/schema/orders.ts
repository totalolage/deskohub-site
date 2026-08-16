import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { NexiCorrelationId } from "@deskohub/nexi";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import {
  type OrderFulfillmentState,
  type OrderId,
  type OrderKind,
  type OrderLineId,
  type OrderPaymentState,
  orderFulfillmentStates,
  orderKinds,
  orderPaymentStates,
} from "@/features/order";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { paymentAttempts } from "./payment-attempts";
import { quotedSqlList } from "./sql-list";

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey().default(postgresUuidV7).$type<OrderId>(),
    kind: text("kind").notNull().$type<OrderKind>(),
    correlationId: text("correlation_id")
      .notNull()
      .unique()
      .default(postgresUuidV7)
      .$type<NexiCorrelationId>(),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    issuanceFingerprint: text("issuance_fingerprint"),
    paymentState: text("payment_state").notNull().$type<OrderPaymentState>(),
    fulfillmentState: text("fulfillment_state")
      .notNull()
      .$type<OrderFulfillmentState>(),
    activePaymentAttemptId: text("active_payment_attempt_id")
      .$type<PaymentAttemptId>()
      .references((): AnyPgColumn => paymentAttempts.id),
    paidAt: instant("paid_at"),
    fulfilledAt: instant("fulfilled_at"),
    fulfillmentFailedAt: instant("fulfillment_failed_at"),
    fulfillmentFailureCode: text("fulfillment_failure_code"),
    writtenOffAt: instant("written_off_at"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "orders_kind_check",
      sql`${t.kind} in (${quotedSqlList(orderKinds)})`
    ),
    check(
      "orders_payment_state_check",
      sql`${t.paymentState} in (${quotedSqlList(orderPaymentStates)})`
    ),
    check(
      "orders_fulfillment_state_check",
      sql`${t.fulfillmentState} in (${quotedSqlList(orderFulfillmentStates)})`
    ),
    check(
      "orders_dotypos_customer_id_check",
      sql`btrim(${t.dotyposCustomerId}) <> ''`
    ),
    check(
      "orders_issuance_fingerprint_check",
      sql`(${t.kind} = 'goods' and ${t.issuanceFingerprint} ~ '^[a-f0-9]{64}$')
        or (${t.kind} <> 'goods' and ${t.issuanceFingerprint} is null)`
    ),
    check(
      "orders_paid_at_check",
      sql`${t.paymentState} <> 'paid' or ${t.paidAt} is not null`
    ),
    check(
      "orders_fulfilled_check",
      sql`${t.fulfillmentState} <> 'fulfilled' or ${t.fulfilledAt} is not null`
    ),
    check(
      "orders_fulfillment_failed_check",
      sql`${t.fulfillmentState} <> 'failed' or (${t.fulfillmentFailedAt} is not null and ${t.fulfillmentFailureCode} is not null)`
    ),
    check(
      "orders_written_off_goods_check",
      sql`${t.writtenOffAt} is null or ${t.kind} = 'goods'`
    ),
    index("orders_customer_created_idx").on(t.dotyposCustomerId, t.createdAt),
    index("orders_states_idx").on(t.paymentState, t.fulfillmentState),
  ]
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: text("id").primaryKey().default(postgresUuidV7).$type<OrderLineId>(),
    orderId: text("order_id")
      .notNull()
      .$type<OrderId>()
      .references(() => orders.id),
    sequence: integer("sequence").notNull(),
    productIdentity: jsonb("product_identity").notNull().$type<unknown>(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceValue: integer("unit_price_value").notNull(),
    undiscountedTotalValue: integer("undiscounted_total_value").notNull(),
    payableTotalValue: integer("payable_total_value").notNull(),
    amountExponent: integer("amount_exponent").notNull(),
    currency: text("currency").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("order_lines_order_sequence_unique_idx").on(
      t.orderId,
      t.sequence
    ),
    index("order_lines_order_idx").on(t.orderId),
    check("order_lines_sequence_check", sql`${t.sequence} >= 0`),
    check(
      "order_lines_product_identity_check",
      sql`jsonb_typeof(${t.productIdentity}) = 'object'
        and jsonb_typeof(${t.productIdentity}->'kind') = 'string'
        and btrim(${t.productIdentity}->>'kind') <> ''`
    ),
    check("order_lines_description_check", sql`btrim(${t.description}) <> ''`),
    check("order_lines_quantity_check", sql`${t.quantity} > 0`),
    check(
      "order_lines_money_check",
      sql`${t.unitPriceValue} >= 0
        and ${t.undiscountedTotalValue} = ${t.unitPriceValue} * ${t.quantity}
        and ${t.payableTotalValue} >= 0
        and ${t.payableTotalValue} <= ${t.undiscountedTotalValue}`
    ),
    check(
      "order_lines_amount_exponent_check",
      sql`${t.amountExponent} = 2`
    ),
    check("order_lines_currency_check", sql`${t.currency} = 'CZK'`),
  ]
);

export type OrderRow = typeof orders.$inferSelect;
export type NewOrderRow = typeof orders.$inferInsert;
export type OrderLineRow = typeof orderLines.$inferSelect;
export type NewOrderLineRow = typeof orderLines.$inferInsert;
