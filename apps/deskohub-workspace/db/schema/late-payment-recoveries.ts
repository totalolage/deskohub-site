import type { DotyposReservationId } from "@deskohub/dotypos";
import type { NexiOperationId, NexiWebhookEventId } from "@deskohub/nexi";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { instant } from "../instant";
import { paymentAttempts } from "./payment-attempts";
import { quotedSqlList } from "./sql-list";
import { workspaceReservations } from "./workspace-reservations";

export const latePaymentRecoveryStates = [
  "pending",
  "processing",
  "recovered",
  "refund_required",
  "review_required",
] as const;

export type LatePaymentRecoveryState =
  (typeof latePaymentRecoveryStates)[number];

export const latePaymentRecoveries = pgTable(
  "late_payment_recoveries",
  {
    paymentAttemptId: text("payment_attempt_id")
      .primaryKey()
      .$type<PaymentAttemptId>()
      .references(() => paymentAttempts.id),
    workspaceReservationId: text("workspace_reservation_id")
      .notNull()
      .$type<WorkspaceReservationId>()
      .references(() => workspaceReservations.id),
    webhookEventId: text("webhook_event_id")
      .notNull()
      .$type<NexiWebhookEventId>(),
    providerOperationId: text("provider_operation_id").$type<NexiOperationId>(),
    providerStatus: text("provider_status"),
    state: text("state").notNull().$type<LatePaymentRecoveryState>(),
    originalDotyposReservationId: text("original_dotypos_reservation_id")
      .notNull()
      .$type<DotyposReservationId>(),
    recoveredDotyposReservationId: text(
      "recovered_dotypos_reservation_id"
    ).$type<DotyposReservationId>(),
    failureCode: text("failure_code"),
    verifiedPaidAt: instant("verified_paid_at").notNull(),
    claimedAt: instant("claimed_at"),
    completedAt: instant("completed_at"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "late_payment_recoveries_state_check",
      sql`${t.state} in (${quotedSqlList(latePaymentRecoveryStates)})`
    ),
    check(
      "late_payment_recoveries_completion_check",
      sql`(${t.state} in ('pending', 'processing') and ${t.completedAt} is null) or (${t.state} in ('recovered', 'refund_required', 'review_required') and ${t.completedAt} is not null)`
    ),
    check(
      "late_payment_recoveries_recovered_booking_check",
      sql`${t.state} <> 'recovered' or ${t.recoveredDotyposReservationId} is not null`
    ),
    check(
      "late_payment_recoveries_failure_check",
      sql`${t.state} not in ('refund_required', 'review_required') or (${t.failureCode} is not null and btrim(${t.failureCode}) <> '')`
    ),
    uniqueIndex("late_payment_recoveries_recovered_reservation_unique_idx")
      .on(t.recoveredDotyposReservationId)
      .where(sql`${t.recoveredDotyposReservationId} is not null`),
    index("late_payment_recoveries_reservation_idx").on(
      t.workspaceReservationId
    ),
    index("late_payment_recoveries_state_updated_idx").on(t.state, t.updatedAt),
  ]
);

export type LatePaymentRecovery = typeof latePaymentRecoveries.$inferSelect;
export type NewLatePaymentRecovery = typeof latePaymentRecoveries.$inferInsert;
