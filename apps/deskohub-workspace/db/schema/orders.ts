import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { NexiCorrelationId } from "@deskohub/nexi";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text } from "drizzle-orm/pg-core";
import {
  type OrderFulfillmentState,
  type OrderId,
  type OrderKind,
  type OrderPaymentState,
  orderFulfillmentStates,
  orderKinds,
  orderPaymentStates,
} from "@/features/order";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
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
    paymentState: text("payment_state").notNull().$type<OrderPaymentState>(),
    fulfillmentState: text("fulfillment_state")
      .notNull()
      .$type<OrderFulfillmentState>(),
    paidAt: instant("paid_at"),
    fulfilledAt: instant("fulfilled_at"),
    fulfillmentFailedAt: instant("fulfillment_failed_at"),
    fulfillmentFailureCode: text("fulfillment_failure_code"),
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
    index("orders_customer_created_idx").on(t.dotyposCustomerId, t.createdAt),
    index("orders_states_idx").on(t.paymentState, t.fulfillmentState),
  ]
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
