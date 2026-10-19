import type { DotyposCustomerId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { AutomationWorkUnitId } from "@/features/email-campaigns/automation/automation-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  type CustomerEventId,
  type CustomerEventKind,
  type CustomerEventSweepSource,
  customerEventKinds,
  customerEventSweepSources,
} from "@/shared/backend/customer-events/customer-event";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { customerAccounts } from "./customer-accounts";
import { quotedSqlList } from "./sql-list";
import { workspaceReservations } from "./workspace-reservations";

/**
 * The outbox and history of trigger-relevant customer events. A row records
 * that something happened and when; it is never read back as reservation
 * state, which only Dotypos holds. The unique indexes make every writer
 * idempotent: a retried write, an overlapping sweep window or the capture
 * reconciler never records the same event twice.
 */
export const customerEvents = pgTable(
  "customer_events",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<CustomerEventId>(),
    kind: text("kind").notNull().$type<CustomerEventKind>(),
    occurredAt: instant("occurred_at").notNull(),
    recordedAt: instant("recorded_at").notNull().default(sql`now()`),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    workspaceReservationId: text("workspace_reservation_id")
      .references(() => workspaceReservations.id, { onDelete: "cascade" })
      .$type<WorkspaceReservationId>(),
    // Accounts survive deletion as tombstones, so production never cascades;
    // only test cleanup hard-deletes reservations and accounts.
    customerAccountId: text("customer_account_id")
      .references(() => customerAccounts.id, { onDelete: "cascade" })
      .$type<CustomerAccountId>(),
    /** The intake unit that owns the event while it's processed. */
    automationUnitId: text("automation_unit_id").$type<AutomationWorkUnitId>(),
    automationProcessedAt: instant("automation_processed_at"),
  },
  (t) => [
    uniqueIndex("customer_events_workspace_write_unique_idx")
      .on(t.kind, t.workspaceReservationId)
      .where(sql`${t.kind} in ('reservation-booked', 'reservation-cancelled')`),
    // Unique per visit time: a re-swept visit conflicts, while a visit that
    // Dotypos moved gets a new event at its new time.
    uniqueIndex("customer_events_visit_unique_idx")
      .on(t.kind, t.workspaceReservationId, t.occurredAt)
      .where(sql`${t.kind} in ('reservation-started', 'reservation-finished')`),
    uniqueIndex("customer_events_account_unique_idx")
      .on(t.kind, t.customerAccountId)
      .where(sql`${t.customerAccountId} is not null`),
    index("customer_events_unprocessed_idx")
      .on(t.recordedAt)
      .where(
        sql`${t.automationProcessedAt} is null and ${t.automationUnitId} is null`
      ),
    index("customer_events_kind_occurred_idx").on(t.kind, t.occurredAt),
    check(
      "customer_events_kind_check",
      sql`${t.kind} in (${quotedSqlList(customerEventKinds)})`
    ),
    check(
      "customer_events_reservation_check",
      sql`(${t.kind} like 'reservation-%') = (${t.workspaceReservationId} is not null)`
    ),
    check(
      "customer_events_account_check",
      sql`(${t.kind} = 'account-created') = (${t.customerAccountId} is not null)`
    ),
  ]
);

/**
 * The cursor of each reservation activity sweep: everything before
 * `swept_until` is swept, and an open window is paged from `next_page`.
 * It holds no reservation id, time or status.
 */
export const customerEventSweeps = pgTable(
  "customer_event_sweeps",
  {
    source: text("source").primaryKey().$type<CustomerEventSweepSource>(),
    sweptUntil: instant("swept_until").notNull(),
    windowStartsAt: instant("window_starts_at"),
    windowEndsAt: instant("window_ends_at"),
    /** The next Dotypos page of the open window; it only increases. */
    nextPage: integer("next_page"),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "customer_event_sweeps_source_check",
      sql`${t.source} in (${quotedSqlList(customerEventSweepSources)})`
    ),
    check(
      "customer_event_sweeps_window_check",
      sql`(${t.windowStartsAt} is null) = (${t.windowEndsAt} is null) and (${t.windowStartsAt} is null) = (${t.nextPage} is null) and (${t.windowStartsAt} is null or ${t.windowStartsAt} < ${t.windowEndsAt}) and (${t.nextPage} is null or ${t.nextPage} >= 1)`
    ),
  ]
);
