import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { NexiCorrelationId } from "@deskohub/nexi";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text } from "drizzle-orm/pg-core";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
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

/**
 * Orders. Each workspace reservation is mirrored into a `reservation` order
 * with the same ID and correlation ID; the reservation stays authoritative.
 *
 * The database owns the mirror: triggers on `workspace_reservations` (see the
 * `payment_order_mirror` migration) upsert the order after every reservation
 * insert and every update that changes a mirrored fact, and delete it with
 * the reservation. Application code never writes reservation orders. The
 * mirrored facts are `dotypos_customer_id`, `payment_state`,
 * `fulfillment_state`, `active_payment_attempt_id`, `paid_at`,
 * `fulfilled_at`, `fulfillment_failed_at`, and `fulfillment_failure_code`.
 *
 * Row locks: the mirror locks the order row (`FOR NO KEY UPDATE`) only inside
 * the reservation statement that already holds that reservation's row lock,
 * so order rows add no wait edge between writers. Payment attempt foreign
 * keys take `KEY SHARE` on the order, which never conflicts with the mirror.
 */
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
    /**
     * The reservation's active payment attempt, mirrored as a plain scalar.
     * It has no foreign key: a reverse reference to `payment_attempts` would
     * make attempt writers lock the order and the order lock the attempt.
     */
    activePaymentAttemptId: text(
      "active_payment_attempt_id"
    ).$type<PaymentAttemptId>(),
    paidAt: instant("paid_at"),
    fulfilledAt: instant("fulfilled_at"),
    fulfillmentFailedAt: instant("fulfillment_failed_at"),
    fulfillmentFailureCode: text("fulfillment_failure_code"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    /**
     * For a reservation order, the reservation's `updated_at` at the last
     * change of a mirrored fact. Reservation writes that change no mirrored
     * fact, such as fulfillment lease renewals, leave the order untouched.
     */
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
