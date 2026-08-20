import { sql } from "drizzle-orm";
import { bytea, check, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { AccountingSnapshotKeyId } from "@/features/accounting/accounting-document-snapshot";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { instant } from "../instant";
import { paymentAttempts } from "./payment-attempts";
import { workspaceReservations } from "./workspace-reservations";

export const accountingDocumentSnapshots = pgTable(
  "accounting_document_snapshots",
  {
    paymentAttemptId: text("payment_attempt_id")
      .primaryKey()
      .$type<PaymentAttemptId>()
      .references(() => paymentAttempts.id),
    workspaceReservationId: text("workspace_reservation_id")
      .notNull()
      .$type<WorkspaceReservationId>()
      .references(() => workspaceReservations.id),
    keyId: text("key_id").notNull().$type<AccountingSnapshotKeyId>(),
    encryptedSnapshot: bytea("encrypted_snapshot").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
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
