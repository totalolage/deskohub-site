import { sql } from "drizzle-orm";
import {
  bytea,
  check,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { instant } from "../instant";
import { paymentAttempts } from "./payment-attempts";
import { workspaceReservations } from "./workspace-reservations";

export const accountingDocumentSnapshots = pgTable(
  "accounting_document_snapshots",
  {
    paymentAttemptId: text("payment_attempt_id")
      .primaryKey()
      .references(() => paymentAttempts.id),
    workspaceReservationId: text("workspace_reservation_id")
      .notNull()
      .references(() => workspaceReservations.id),
    schemaVersion: integer("schema_version").notNull(),
    keyId: text("key_id").notNull(),
    encryptedSnapshot: bytea("encrypted_snapshot").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "accounting_document_snapshots_schema_version_check",
      sql`${t.schemaVersion} > 0`
    ),
    check(
      "accounting_document_snapshots_key_id_check",
      sql`${t.keyId} ~ '^[A-Z][A-Z0-9_]{2,31}$'`
    ),
    uniqueIndex("accounting_document_snapshots_reservation_attempt_idx").on(
      t.workspaceReservationId,
      t.paymentAttemptId
    ),
  ]
);

export type AccountingDocumentSnapshotRow =
  typeof accountingDocumentSnapshots.$inferSelect;
