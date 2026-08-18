import type { DotyposCustomerId } from "@deskohub/dotypos";
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
import type { AccountingSnapshotKeyId } from "@/features/accounting/accounting-document-snapshot";
import type { InvoiceNumber } from "@/features/accounting/invoice";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { accountingDocumentSnapshots } from "./accounting-document-snapshots";
import { workspaceReservations } from "./workspace-reservations";

export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    workspaceReservationId: text("workspace_reservation_id")
      .$type<WorkspaceReservationId>()
      .references(() => workspaceReservations.id),
    paymentAttemptId: text("payment_attempt_id")
      .$type<PaymentAttemptId>()
      .references(() => accountingDocumentSnapshots.paymentAttemptId),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    invoiceNumber: text("invoice_number").notNull().$type<InvoiceNumber>(),
    numberingYear: integer("numbering_year").notNull(),
    numberingSequence: integer("numbering_sequence").notNull(),
    keyId: text("key_id").notNull().$type<AccountingSnapshotKeyId>(),
    encryptedDocument: bytea("encrypted_document").notNull(),
    issuedAt: instant("issued_at").notNull(),
  },
  (t) => [
    check(
      "invoices_dotypos_customer_id_check",
      sql`btrim(${t.dotyposCustomerId}) <> ''`
    ),
    check("invoices_numbering_sequence_check", sql`${t.numberingSequence} > 0`),
    check(
      "invoices_source_reference_check",
      sql`(${t.workspaceReservationId} is null) = (${t.paymentAttemptId} is null)`
    ),
    check("invoices_key_id_check", sql`${t.keyId} ~ '^[A-Z][A-Z0-9_]{2,31}$'`),
    check(
      "invoices_issued_at_year_check",
      sql`${t.numberingYear} = extract(year from ${t.issuedAt} at time zone 'Europe/Prague')::integer`
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
