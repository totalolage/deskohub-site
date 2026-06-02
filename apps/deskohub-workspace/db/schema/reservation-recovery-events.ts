import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const reservationRecoveryEvents = pgTable(
  "reservation_recovery_events",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id"),
    reservationSubmitKey: text("reservation_submit_key").notNull(),
    dotyposCustomerId: text("dotypos_customer_id").notNull(),
    dotyposReservationId: text("dotypos_reservation_id").notNull(),
    attemptedCancellationResult: text("attempted_cancellation_result"),
    cancellationAttemptedAt: timestamp("cancellation_attempted_at", {
      withTimezone: true,
      mode: "date",
    }),
    failureReason: text("failure_reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("reservation_recovery_order_idx").on(t.orderId),
    index("reservation_recovery_submit_key_idx").on(t.reservationSubmitKey),
    index("reservation_recovery_dotypos_reservation_idx").on(
      t.dotyposReservationId
    ),
  ]
);

export type ReservationRecoveryEvent =
  typeof reservationRecoveryEvents.$inferSelect;
export type NewReservationRecoveryEvent =
  typeof reservationRecoveryEvents.$inferInsert;
