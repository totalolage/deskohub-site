import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { locales } from "@/features/i18n";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { quotedSqlList } from "./sql-list";

export const reservationStates = [
  "draft",
  "creating_hold",
  "held",
  "hold_expired",
  "confirming",
  "confirmed",
  "cancelling",
  "cancelled",
  "cancellation_failed",
] as const;

export const paymentStates = [
  "not_started",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
] as const;

export const fulfillmentStates = [
  "not_started",
  "processing",
  "fulfilled",
  "failed",
] as const;

export type ReservationState = (typeof reservationStates)[number];
export type PaymentState = (typeof paymentStates)[number];
export type FulfillmentState = (typeof fulfillmentStates)[number];

export const cancellationFailureDispositions = [
  "retryable",
  "manual_review",
] as const;

export type CancellationFailureDisposition =
  (typeof cancellationFailureDispositions)[number];

export const cancellationRecoveryReasons = [
  "hold_expired",
  "attachment_compensation",
  "supersession_recovery",
  "retryable_failure",
  "stale_claim_recovery",
] as const;

export type CancellationRecoveryReason =
  (typeof cancellationRecoveryReasons)[number];

const reservationStatesRequiringDotyposReservationId = [
  "held",
  "confirming",
  "confirmed",
  "cancelling",
  "cancelled",
  "cancellation_failed",
] as const satisfies readonly ReservationState[];

export const workspaceReservations = pgTable(
  "workspace_reservations",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    checkoutSessionKey: text("checkout_session_key")
      .notNull()
      .default(postgresUuidV7),
    checkoutAttemptKey: text("checkout_attempt_key").notNull(),
    correlationId: text("correlation_id")
      .notNull()
      .unique()
      .default(postgresUuidV7),
    dotyposCustomerId: text("dotypos_customer_id").notNull(),
    dotyposReservationId: text("dotypos_reservation_id"),
    customerAccessCode: text("customer_access_code").notNull(),
    reservationState: text("reservation_state")
      .notNull()
      .$type<ReservationState>(),
    paymentState: text("payment_state").notNull().$type<PaymentState>(),
    fulfillmentState: text("fulfillment_state")
      .notNull()
      .$type<FulfillmentState>(),
    activePaymentAttemptId: text("active_payment_attempt_id"),
    reservationDetails: jsonb("reservation_details")
      .$type<StoredWorkspaceReservationDetails>()
      .notNull(),
    locale: text("locale").notNull(),
    reservationHoldExpiresAt: instant("reservation_hold_expires_at"),
    reservationHoldExpiredAt: instant("reservation_hold_expired_at"),
    reservationCreatedAt: instant("reservation_created_at"),
    reservationConfirmedAt: instant("reservation_confirmed_at"),
    reservationCancelledAt: instant("reservation_cancelled_at"),
    cancellationClaimOwner: text("cancellation_claim_owner"),
    cancellationClaimedAt: instant("cancellation_claimed_at"),
    cancellationFailureDisposition: text(
      "cancellation_failure_disposition"
    ).$type<CancellationFailureDisposition>(),
    cancellationRetryAt: instant("cancellation_retry_at"),
    cancellationRecoveryReason: text(
      "cancellation_recovery_reason"
    ).$type<CancellationRecoveryReason>(),
    paidAt: instant("paid_at"),
    fulfilledAt: instant("fulfilled_at"),
    fulfillmentFailedAt: instant("fulfillment_failed_at"),
    failureCode: text("failure_code"),
    fulfillmentFailureCode: text("fulfillment_failure_code"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "workspace_reservations_reservation_state_check",
      sql`${t.reservationState} in (${quotedSqlList(reservationStates)})`
    ),
    check(
      "workspace_reservations_payment_state_check",
      sql`${t.paymentState} in (${quotedSqlList(paymentStates)})`
    ),
    check(
      "workspace_reservations_fulfillment_state_check",
      sql`${t.fulfillmentState} in (${quotedSqlList(fulfillmentStates)})`
    ),
    check(
      "workspace_reservations_locale_check",
      sql`${t.locale} in (${quotedSqlList(locales)})`
    ),
    check(
      "workspace_reservations_hold_id_check",
      sql`${t.reservationState} not in (${quotedSqlList(reservationStatesRequiringDotyposReservationId)}) or ${t.dotyposReservationId} is not null`
    ),
    check(
      "workspace_reservations_paid_at_check",
      sql`${t.paymentState} <> 'paid' or ${t.paidAt} is not null`
    ),
    check(
      "workspace_reservations_fulfilled_check",
      sql`${t.fulfillmentState} <> 'fulfilled' or ${t.fulfilledAt} is not null`
    ),
    check(
      "workspace_reservations_fulfillment_failed_check",
      sql`${t.fulfillmentState} <> 'failed' or (${t.fulfillmentFailedAt} is not null and ${t.fulfillmentFailureCode} is not null)`
    ),
    check(
      "workspace_reservations_cancellation_claim_check",
      sql`(
        ${t.cancellationClaimOwner} is null
        and ${t.cancellationClaimedAt} is null
      ) or (
        ${t.cancellationClaimOwner} is not null
        and ${t.cancellationClaimedAt} is not null
      )`
    ),
    check(
      "workspace_reservations_cancellation_failure_check",
      sql`(
        ${t.cancellationFailureDisposition} is null
        and ${t.cancellationRetryAt} is null
      ) or (
        ${t.cancellationFailureDisposition} = 'retryable'
        and ${t.cancellationRetryAt} is not null
      ) or (
        ${t.cancellationFailureDisposition} = 'manual_review'
        and ${t.cancellationRetryAt} is null
      )`
    ),
    check(
      "workspace_reservations_cancellation_recovery_reason_check",
      sql`${t.cancellationRecoveryReason} is null or ${t.cancellationRecoveryReason} in (${quotedSqlList(cancellationRecoveryReasons)})`
    ),
    uniqueIndex("workspace_reservations_attempt_key_unique_idx").on(
      t.checkoutAttemptKey
    ),
    uniqueIndex("workspace_reservations_active_session_unique_idx")
      .on(t.checkoutSessionKey)
      .where(sql`${t.reservationState} <> 'cancelled'`),
    index("workspace_reservations_checkout_session_idx").on(
      t.checkoutSessionKey,
      t.createdAt
    ),
    uniqueIndex("workspace_reservations_dotypos_reservation_unique_idx")
      .on(t.dotyposReservationId)
      .where(sql`${t.dotyposReservationId} is not null`),
    index("workspace_reservations_states_idx").on(
      t.reservationState,
      t.paymentState,
      t.fulfillmentState
    ),
    index("workspace_reservations_expired_holds_idx")
      .on(t.reservationHoldExpiresAt)
      .where(sql`${t.reservationState} = 'held'`),
    index("workspace_reservations_cancellation_recovery_idx")
      .on(
        t.reservationState,
        t.cancellationRecoveryReason,
        t.cancellationFailureDisposition,
        t.cancellationRetryAt,
        t.cancellationClaimedAt
      )
      .where(
        sql`${t.reservationState} in ('cancelling', 'cancellation_failed')`
      ),
    index("workspace_reservations_dotypos_customer_idx").on(
      t.dotyposCustomerId
    ),
  ]
);

export type WorkspaceReservation = typeof workspaceReservations.$inferSelect;
export type NewWorkspaceReservation = typeof workspaceReservations.$inferInsert;
