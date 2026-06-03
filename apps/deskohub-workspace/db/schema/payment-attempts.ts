import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { postgresUuidV7 } from "../uuid-v7";
import { quotedSqlList } from "./sql-list";
import { workspaceReservations } from "./workspace-reservations";

export const paymentAttemptStates = [
  "created",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
] as const;

export type PaymentAttemptState = (typeof paymentAttemptStates)[number];

export const paymentProviders = ["nexi"] as const;

export type PaymentProvider = (typeof paymentProviders)[number];

const paymentAttemptStatesRequiringFailureCode = [
  "failed",
  "cancelled",
  "expired",
] as const satisfies readonly PaymentAttemptState[];

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    workspaceReservationId: text("workspace_reservation_id")
      .notNull()
      .references(() => workspaceReservations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().$type<PaymentProvider>(),
    providerOrderId: text("provider_order_id").notNull(),
    securityToken: text("security_token"),
    state: text("state").notNull().$type<PaymentAttemptState>(),
    amountValue: integer("amount_value").notNull(),
    amountExponent: integer("amount_exponent").notNull(),
    currency: text("currency").notNull(),
    providerRedirectUrl: text("provider_redirect_url"),
    lastWebhookEventId: text("last_webhook_event_id"),
    lastProviderOperationId: text("last_provider_operation_id"),
    lastProviderStatus: text("last_provider_status"),
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "payment_attempts_provider_check",
      sql`${t.provider} in (${quotedSqlList(paymentProviders)})`
    ),
    check(
      "payment_attempts_state_check",
      sql`${t.state} in (${quotedSqlList(paymentAttemptStates)})`
    ),
    check("payment_attempts_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "payment_attempts_failure_code_check",
      sql`${t.state} not in (${quotedSqlList(paymentAttemptStatesRequiringFailureCode)}) or ${t.failureCode} is not null`
    ),
    uniqueIndex("payment_attempts_provider_order_unique_idx").on(
      t.provider,
      t.providerOrderId
    ),
    index("payment_attempts_workspace_reservation_idx").on(
      t.workspaceReservationId
    ),
    index("payment_attempts_state_created_idx").on(t.state, t.createdAt),
  ]
);

export const paymentAttemptsRelations = relations(
  paymentAttempts,
  ({ one }) => ({
    workspaceReservation: one(workspaceReservations, {
      fields: [paymentAttempts.workspaceReservationId],
      references: [workspaceReservations.id],
    }),
  })
);

export type PaymentAttempt = typeof paymentAttempts.$inferSelect;
export type NewPaymentAttempt = typeof paymentAttempts.$inferInsert;
