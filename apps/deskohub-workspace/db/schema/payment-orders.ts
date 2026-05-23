import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";

export const paymentStatuses = [
  "created",
  "payment_pending",
  "paid",
  "payment_failed",
  "cancelled",
  "expired",
] as const;

export const fulfillmentStatuses = [
  "not_started",
  "fulfilled",
  "failed",
] as const;

export type PaymentStatus = (typeof paymentStatuses)[number];
export type FulfillmentStatus = (typeof fulfillmentStatuses)[number];

export const paymentOrders = pgTable(
  "payment_orders",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull().$type<"nexi">(),
    dotyposCustomerId: text("dotypos_customer_id").notNull(),
    correlationId: text("correlation_id").notNull().unique(),
    dotyposReservationId: text("dotypos_reservation_id"),
    securityToken: text("security_token"),
    checkoutDetails: jsonb("checkout_details")
      .notNull()
      .$type<CheckoutDetailsJson>(),
    paymentStatus: text("payment_status").notNull().$type<PaymentStatus>(),
    fulfillmentStatus: text("fulfillment_status")
      .notNull()
      .$type<FulfillmentStatus>(),
    lastWebhookEventId: text("last_webhook_event_id"),
    lastProviderOperationId: text("last_provider_operation_id"),
    lastProviderStatus: text("last_provider_status"),
    failureCode: text("failure_code"),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    reservationCreatedAt: timestamp("reservation_created_at", {
      withTimezone: true,
      mode: "date",
    }),
    customerAccessEmailSentAt: timestamp("customer_access_email_sent_at", {
      withTimezone: true,
      mode: "date",
    }),
    internalNotificationSentAt: timestamp("internal_notification_sent_at", {
      withTimezone: true,
      mode: "date",
    }),
    fulfilledAt: timestamp("fulfilled_at", {
      withTimezone: true,
      mode: "date",
    }),
    fulfillmentFailedAt: timestamp("fulfillment_failed_at", {
      withTimezone: true,
      mode: "date",
    }),
    fulfillmentFailureCode: text("fulfillment_failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("payment_orders_provider_check", sql`${t.provider} in ('nexi')`),
    check(
      "payment_orders_payment_status_check",
      sql`${t.paymentStatus} in ('created', 'payment_pending', 'paid', 'payment_failed', 'cancelled', 'expired')`
    ),
    check(
      "payment_orders_fulfillment_status_check",
      sql`${t.fulfillmentStatus} in ('not_started', 'fulfilled', 'failed')`
    ),
    check(
      "payment_orders_paid_at_check",
      sql`${t.paymentStatus} <> 'paid' or ${t.paidAt} is not null`
    ),
    check(
      "payment_orders_fulfilled_check",
      sql`${t.fulfillmentStatus} <> 'fulfilled' or (${t.fulfilledAt} is not null and ${t.dotyposReservationId} is not null)`
    ),
    check(
      "payment_orders_fulfillment_failed_check",
      sql`${t.fulfillmentStatus} <> 'failed' or (${t.fulfillmentFailedAt} is not null and ${t.fulfillmentFailureCode} is not null)`
    ),
    index("payment_orders_recovery_idx").on(
      t.paymentStatus,
      t.fulfillmentStatus
    ),
    index("payment_orders_dotypos_customer_idx").on(t.dotyposCustomerId),
    index("payment_orders_dotypos_reservation_idx")
      .on(t.dotyposReservationId)
      .where(sql`${t.dotyposReservationId} is not null`),
  ]
);

export type PaymentOrder = typeof paymentOrders.$inferSelect;
export type NewPaymentOrder = typeof paymentOrders.$inferInsert;
