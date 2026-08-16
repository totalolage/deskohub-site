import type {
  NexiOperationId,
  NexiOrderId,
  NexiWebhookEventId,
} from "@deskohub/nexi";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { OrderId } from "@/features/order";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { orders } from "./orders";
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

export const paymentRefundStates = ["not_required", "required"] as const;

export type PaymentRefundState = (typeof paymentRefundStates)[number];

export const paymentProviders = ["nexi", "internal"] as const;

export type PaymentProvider = (typeof paymentProviders)[number];

const paymentAttemptStatesRequiringFailureCode = [
  "failed",
  "cancelled",
  "expired",
] as const satisfies readonly PaymentAttemptState[];

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<PaymentAttemptId>(),
    orderId: text("order_id")
      .$type<OrderId>()
      .references((): AnyPgColumn => orders.id, { onDelete: "cascade" }),
    workspaceReservationId: text("workspace_reservation_id")
      .$type<WorkspaceReservationId>()
      .references(() => workspaceReservations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().$type<PaymentProvider>(),
    providerOrderId: text("provider_order_id").$type<NexiOrderId>(),
    securityToken: text("security_token"),
    state: text("state").notNull().$type<PaymentAttemptState>(),
    refundState: text("refund_state")
      .notNull()
      .default("not_required")
      .$type<PaymentRefundState>(),
    amountValue: integer("amount_value").notNull(),
    amountExponent: integer("amount_exponent").notNull(),
    currency: text("currency").notNull(),
    providerRedirectUrl: text("provider_redirect_url"),
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
      "payment_attempts_provider_check",
      sql`${t.provider} in (${quotedSqlList(paymentProviders)})`
    ),
    check(
      "payment_attempts_state_check",
      sql`${t.state} in (${quotedSqlList(paymentAttemptStates)})`
    ),
    check(
      "payment_attempts_refund_state_check",
      sql`${t.refundState} in (${quotedSqlList(paymentRefundStates)}) and (${t.refundState} <> 'required' or (${t.provider} = 'nexi' and ${t.state} = 'paid'))`
    ),
    check("payment_attempts_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "payment_attempts_amount_check",
      sql`(${t.provider} = 'nexi' and ${t.amountValue} > 0) or (${t.provider} = 'internal' and ${t.amountValue} = 0)`
    ),
    check(
      "payment_attempts_provider_fields_check",
      sql`(${t.provider} = 'nexi' and ${t.providerOrderId} is not null) or (${t.provider} = 'internal' and ${t.providerOrderId} is null and ${t.securityToken} is null and ${t.providerRedirectUrl} is null and ${t.lastWebhookEventId} is null and ${t.lastProviderOperationId} is null and ${t.lastProviderStatus} is null and ${t.providerOrderCreatedAt} is null)`
    ),
    check(
      "payment_attempts_internal_state_check",
      sql`${t.provider} <> 'internal' or (${t.state} = 'paid' and ${t.failureCode} is null)`
    ),
    check(
      "payment_attempts_failure_code_check",
      sql`${t.state} not in (${quotedSqlList(paymentAttemptStatesRequiringFailureCode)}) or ${t.failureCode} is not null`
    ),
    check(
      "payment_attempts_order_reference_check",
      sql`${t.orderId} is not null or ${t.workspaceReservationId} is not null`
    ),
    check(
      "payment_attempts_reservation_order_match_check",
      sql`${t.workspaceReservationId} is null or ${t.orderId} is null or ${t.workspaceReservationId} = ${t.orderId}`
    ),
    uniqueIndex("payment_attempts_nexi_order_unique_idx")
      .on(t.providerOrderId)
      .where(sql`${t.provider} = 'nexi'`),
    index("payment_attempts_workspace_reservation_idx").on(
      t.workspaceReservationId
    ),
    index("payment_attempts_order_idx").on(t.orderId),
    index("payment_attempts_state_created_idx").on(t.state, t.createdAt),
  ]
);

export type PaymentAttemptRow = typeof paymentAttempts.$inferSelect;
export type NewPaymentAttemptRow = typeof paymentAttempts.$inferInsert;
