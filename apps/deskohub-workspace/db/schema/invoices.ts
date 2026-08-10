import { sql } from "drizzle-orm";
import {
  bytea,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { accountingDocumentSnapshots } from "./accounting-document-snapshots";
import { workspaceReservations } from "./workspace-reservations";

export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    workspaceReservationId: text("workspace_reservation_id")
      .notNull()
      .references(() => workspaceReservations.id),
    paymentAttemptId: text("payment_attempt_id")
      .notNull()
      .references(() => accountingDocumentSnapshots.paymentAttemptId),
    dotyposCustomerId: text("dotypos_customer_id").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    numberingYear: integer("numbering_year").notNull(),
    numberingSequence: integer("numbering_sequence").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    keyId: text("key_id").notNull(),
    encryptedDocument: bytea("encrypted_document").notNull(),
    issuedAt: instant("issued_at").notNull(),
  },
  (t) => [
    check(
      "invoices_dotypos_customer_id_check",
      sql`btrim(${t.dotyposCustomerId}) <> ''`
    ),
    check(
      "invoices_numbering_year_check",
      sql`${t.numberingYear} between 2000 and 9999`
    ),
    check(
      "invoices_numbering_sequence_check",
      sql`${t.numberingSequence} between 1 and 999999`
    ),
    check("invoices_schema_version_check", sql`${t.schemaVersion} > 0`),
    check("invoices_key_id_check", sql`${t.keyId} ~ '^[A-Z][A-Z0-9_]{2,31}$'`),
    check(
      "invoices_issued_at_year_check",
      sql`${t.numberingYear} = extract(year from ${t.issuedAt} at time zone 'Europe/Prague')::integer`
    ),
    check(
      "invoices_number_format_check",
      sql`${t.invoiceNumber} = 'WS-FV-' || ${t.numberingYear}::text || '-' || lpad(${t.numberingSequence}::text, 6, '0')`
    ),
    uniqueIndex("invoices_reservation_unique_idx").on(t.workspaceReservationId),
    uniqueIndex("invoices_payment_attempt_unique_idx").on(t.paymentAttemptId),
    uniqueIndex("invoices_number_unique_idx").on(t.invoiceNumber),
    uniqueIndex("invoices_year_sequence_unique_idx").on(
      t.numberingYear,
      t.numberingSequence
    ),
    index("invoices_dotypos_customer_idx").on(t.dotyposCustomerId),
  ]
);

export type InvoiceRow = typeof invoices.$inferSelect;
