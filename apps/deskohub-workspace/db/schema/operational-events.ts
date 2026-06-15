import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { postgresUuidV7 } from "../uuid-v7";
import { paymentAttempts } from "./payment-attempts";
import { quotedSqlList } from "./sql-list";
import { workspaceReservations } from "./workspace-reservations";

export const operationalEventSeverities = ["info", "warning", "error"] as const;

export type OperationalEventSeverity =
  (typeof operationalEventSeverities)[number];

export const operationalEvents = pgTable(
  "operational_events",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    workspaceReservationId: text("workspace_reservation_id").references(
      () => workspaceReservations.id,
      { onDelete: "set null" }
    ),
    paymentAttemptId: text("payment_attempt_id").references(
      () => paymentAttempts.id,
      { onDelete: "set null" }
    ),
    eventType: text("event_type").notNull(),
    severity: text("severity").notNull().$type<OperationalEventSeverity>(),
    message: text("message").notNull(),
    failureCode: text("failure_code"),
    dotyposReservationId: text("dotypos_reservation_id"),
    dotyposCustomerId: text("dotypos_customer_id"),
    webhookEventId: text("webhook_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "operational_events_severity_check",
      sql`${t.severity} in (${quotedSqlList(operationalEventSeverities)})`
    ),
    index("operational_events_workspace_reservation_idx").on(
      t.workspaceReservationId
    ),
    index("operational_events_payment_attempt_idx").on(t.paymentAttemptId),
    index("operational_events_type_created_idx").on(t.eventType, t.createdAt),
    index("operational_events_severity_created_idx").on(
      t.severity,
      t.createdAt
    ),
  ]
);

export type OperationalEvent = typeof operationalEvents.$inferSelect;
export type NewOperationalEvent = typeof operationalEvents.$inferInsert;
