import type {
  DotyposCustomerId,
  DotyposReservationId,
  DotyposTableId,
} from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { instant } from "../instant";
import { workspaceReservations } from "./workspace-reservations";

/** An attempted move and, once attached, the history of the replaced hold. */
export const unlimitedPassDayMoves = pgTable(
  "unlimited_pass_day_moves",
  {
    generation: uuid("generation").primaryKey(),
    reservationId: text("reservation_id")
      .notNull()
      .$type<WorkspaceReservationId>()
      .references(() => workspaceReservations.id),
    customerId: text("customer_id").notNull().$type<DotyposCustomerId>(),
    sourceReservationId: text("source_reservation_id")
      .notNull()
      .$type<DotyposReservationId>(),
    sourceTableId: text("source_table_id").notNull().$type<DotyposTableId>(),
    sourceGeneration: uuid("source_generation"),
    targetReservationId: text(
      "target_reservation_id"
    ).$type<DotyposReservationId>(),
    targetTableId: text("target_table_id").notNull().$type<DotyposTableId>(),
    requestedAt: instant("requested_at").notNull(),
    checkedAt: instant("checked_at").notNull(),
    attachedAt: instant("attached_at"),
    settledAt: instant("settled_at"),
    ambiguousAt: instant("ambiguous_at"),
    ambiguousReservationIds: text("ambiguous_reservation_ids")
      .$type<DotyposReservationId>()
      .array(),
  },
  (t) => [
    uniqueIndex("unlimited_pass_day_moves_pending_reservation_idx")
      .on(t.reservationId)
      .where(sql`${t.settledAt} is null`),
    index("unlimited_pass_day_moves_pending_checked_idx")
      .on(t.checkedAt)
      .where(sql`${t.settledAt} is null`),
    index("unlimited_pass_day_moves_source_idx").on(t.sourceReservationId),
    uniqueIndex("unlimited_pass_day_moves_target_idx")
      .on(t.targetReservationId)
      .where(sql`${t.targetReservationId} is not null`),
    check(
      "unlimited_pass_day_moves_destination_check",
      sql`${t.targetTableId} <> ${t.sourceTableId}
        and ${t.targetReservationId} is distinct from ${t.sourceReservationId}
        and (${t.attachedAt} is null or ${t.targetReservationId} is not null)`
    ),
  ]
);
