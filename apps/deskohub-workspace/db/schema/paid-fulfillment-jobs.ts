import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { paymentPaidEvents } from "./payment-paid-events";
import { quotedSqlList } from "./sql-list";
import { workspaceReservations } from "./workspace-reservations";

export const paidFulfillmentJobStates = [
  "pending",
  "processing",
  "completed",
  "manual",
] as const;

export type PaidFulfillmentJobState = (typeof paidFulfillmentJobStates)[number];

export const paidFulfillmentMaxAttempts = 8;

export const paidFulfillmentJobs = pgTable(
  "paid_fulfillment_jobs",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    paymentPaidEventId: text("payment_paid_event_id")
      .notNull()
      .unique()
      .references(() => paymentPaidEvents.id),
    workspaceReservationId: text("workspace_reservation_id")
      .notNull()
      .references(() => workspaceReservations.id),
    state: text("state")
      .notNull()
      .$type<PaidFulfillmentJobState>()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    leaseOwnerId: text("lease_owner_id"),
    claimedAt: instant("claimed_at"),
    nextAttemptAt: instant("next_attempt_at").notNull().default(sql`now()`),
    completedAt: instant("completed_at"),
    failureCode: text("failure_code"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "paid_fulfillment_jobs_state_check",
      sql`${t.state} in (${quotedSqlList(paidFulfillmentJobStates)})`
    ),
    check(
      "paid_fulfillment_jobs_attempt_count_check",
      sql`${t.attemptCount} between 0 and ${paidFulfillmentMaxAttempts}`
    ),
    check(
      "paid_fulfillment_jobs_lease_check",
      sql`(
        ${t.state} = 'processing'
        and ${t.leaseOwnerId} is not null
        and btrim(${t.leaseOwnerId}) <> ''
        and ${t.claimedAt} is not null
      ) or (
        ${t.state} <> 'processing'
        and ${t.leaseOwnerId} is null
        and ${t.claimedAt} is null
      )`
    ),
    check(
      "paid_fulfillment_jobs_completed_check",
      sql`(${t.state} = 'completed' and ${t.completedAt} is not null) or (${t.state} <> 'completed' and ${t.completedAt} is null)`
    ),
    check(
      "paid_fulfillment_jobs_manual_check",
      sql`${t.state} <> 'manual' or ${t.failureCode} is not null`
    ),
    index("paid_fulfillment_jobs_due_idx").on(t.state, t.nextAttemptAt),
    index("paid_fulfillment_jobs_reservation_idx").on(t.workspaceReservationId),
  ]
);

export type PaidFulfillmentJob = typeof paidFulfillmentJobs.$inferSelect;
