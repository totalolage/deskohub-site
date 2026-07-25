import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { paymentAttempts } from "./payment-attempts";
import { workspaceReservations } from "./workspace-reservations";

export const paymentPaidEvents = pgTable(
  "payment_paid_events",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    paymentAttemptId: text("payment_attempt_id")
      .notNull()
      .references(() => paymentAttempts.id),
    workspaceReservationId: text("workspace_reservation_id")
      .notNull()
      .references(() => workspaceReservations.id),
    paidAt: instant("paid_at").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("payment_paid_events_attempt_unique_idx").on(
      t.paymentAttemptId
    ),
    index("payment_paid_events_reservation_idx").on(t.workspaceReservationId),
  ]
);

export type PaymentPaidEvent = typeof paymentPaidEvents.$inferSelect;
