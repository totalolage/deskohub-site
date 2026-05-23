import { relations, sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { paymentOrders } from "./payment-orders";

export const webhookEventStatuses = [
  "received",
  "processed",
  "failed",
] as const;

export type WebhookEventStatus = (typeof webhookEventStatuses)[number];

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull().$type<"nexi">(),
    eventId: text("event_id").notNull().unique(),
    paymentOrderId: text("payment_order_id").references(() => paymentOrders.id),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    status: text("status").notNull().$type<WebhookEventStatus>(),
    processedAt: timestamp("processed_at", {
      withTimezone: true,
      mode: "date",
    }),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("webhook_events_provider_check", sql`${t.provider} in ('nexi')`),
    check(
      "webhook_events_status_check",
      sql`${t.status} in ('received', 'processed', 'failed')`
    ),
    check(
      "webhook_events_processed_check",
      sql`${t.status} <> 'processed' or ${t.processedAt} is not null`
    ),
    check(
      "webhook_events_failed_check",
      sql`${t.status} <> 'failed' or ${t.errorCode} is not null`
    ),
    index("webhook_events_payment_order_idx")
      .on(t.paymentOrderId)
      .where(sql`${t.paymentOrderId} is not null`),
    index("webhook_events_status_received_idx").on(t.status, t.receivedAt),
  ]
);

export const webhookEventsRelations = relations(webhookEvents, ({ one }) => ({
  paymentOrder: one(paymentOrders, {
    fields: [webhookEvents.paymentOrderId],
    references: [paymentOrders.id],
  }),
}));

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
