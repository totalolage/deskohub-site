import { sql } from "drizzle-orm";
import { check, index, pgTable, text } from "drizzle-orm/pg-core";
import { instant } from "../instant";
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
    receivedAt: instant("received_at").notNull(),
    processedAt: instant("processed_at"),
    state: text("state").notNull().$type<WebhookEventState>(),
    errorCode: text("error_code"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
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

export type WebhookEvent = typeof webhookEvents.$inferSelect;
