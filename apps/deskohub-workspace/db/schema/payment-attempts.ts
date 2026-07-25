import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { DiscountId } from "@/features/discounts";
import { instant } from "../instant";
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
    admissionVersion: integer("admission_version").notNull().default(1),
    pricingFingerprint: text("pricing_fingerprint"),
    displayedDiscountIds: jsonb("displayed_discount_ids").$type<
      readonly DiscountId[]
    >(),
    providerStartLeaseId: text("provider_start_lease_id"),
    providerStartLeaseExpiresAt: instant("provider_start_lease_expires_at"),
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
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
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
      "payment_attempts_admission_version_check",
      sql`${t.admissionVersion} in (1, 2)`
    ),
    check(
      "payment_attempts_pricing_identity_check",
      sql`${t.admissionVersion} < 2 or (
        ${t.pricingFingerprint} is not null
        and btrim(${t.pricingFingerprint}) <> ''
        and ${t.displayedDiscountIds} is not null
        and jsonb_typeof(${t.displayedDiscountIds}) = 'array'
      )`
    ),
    check(
      "payment_attempts_v2_created_lease_check",
      sql`${t.admissionVersion} < 2 or ${t.state} <> 'created' or (
        ${t.providerStartLeaseId} is not null
        and ${t.providerStartLeaseExpiresAt} is not null
      )`
    ),
    check(
      "payment_attempts_provider_start_lease_check",
      sql`(
        ${t.providerStartLeaseId} is null
        and ${t.providerStartLeaseExpiresAt} is null
      ) or (
        ${t.state} = 'created'
        and btrim(${t.providerStartLeaseId}) <> ''
        and ${t.providerStartLeaseExpiresAt} is not null
      )`
    ),
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

export type PaymentAttemptRow = typeof paymentAttempts.$inferSelect;
export type NewPaymentAttemptRow = typeof paymentAttempts.$inferInsert;
