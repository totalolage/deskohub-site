import { relations, sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { postgresUuidV7 } from "../uuid-v7";
import {
  type PaymentProvider,
  paymentAttempts,
  paymentProviders,
} from "./payment-attempts";
import { quotedSqlList } from "./sql-list";

export const webhookEventStates = ["received", "processed", "failed"] as const;

export type WebhookEventState = (typeof webhookEventStates)[number];

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    provider: text("provider").notNull().$type<PaymentProvider>(),
    eventId: text("event_id").notNull().unique(),
    paymentAttemptId: text("payment_attempt_id").references(
      () => paymentAttempts.id
    ),
    providerOrderId: text("provider_order_id"),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    processedAt: timestamp("processed_at", {
      withTimezone: true,
      mode: "date",
    }),
    state: text("state").notNull().$type<WebhookEventState>(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "webhook_events_provider_check",
      sql`${t.provider} in (${quotedSqlList(paymentProviders)})`
    ),
    check(
      "webhook_events_state_check",
      sql`${t.state} in (${quotedSqlList(webhookEventStates)})`
    ),
    check(
      "webhook_events_processed_check",
      sql`${t.state} <> 'processed' or ${t.processedAt} is not null`
    ),
    check(
      "webhook_events_failed_check",
      sql`${t.state} <> 'failed' or ${t.errorCode} is not null`
    ),
    index("webhook_events_payment_attempt_idx")
      .on(t.paymentAttemptId)
      .where(sql`${t.paymentAttemptId} is not null`),
    index("webhook_events_provider_order_idx")
      .on(t.providerOrderId)
      .where(sql`${t.providerOrderId} is not null`),
    index("webhook_events_state_received_idx").on(t.state, t.receivedAt),
  ]
);

export const webhookEventsRelations = relations(webhookEvents, ({ one }) => ({
  paymentAttempt: one(paymentAttempts, {
    fields: [webhookEvents.paymentAttemptId],
    references: [paymentAttempts.id],
  }),
}));

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
