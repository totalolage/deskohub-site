import { sql } from "drizzle-orm";
import { check, pgTable, text } from "drizzle-orm/pg-core";
import type { AccountingSnapshotKeyId } from "@/features/accounting/accounting-document-snapshot";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import { instant } from "../instant";

export const manualInvoiceCreationRequests = pgTable(
  "manual_invoice_creation_requests",
  {
    invoiceId: text("invoice_id").primaryKey().$type<InvoiceId>(),
    keyId: text("key_id").notNull().$type<AccountingSnapshotKeyId>(),
    requestDigest: text("request_digest").notNull(),
    claimedAt: instant("claimed_at").notNull().default(sql`now()`),
    completedAt: instant("completed_at"),
  },
  (t) => [
    check(
      "manual_invoice_creation_requests_invoice_id_check",
      sql`${t.invoiceId} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`
    ),
    check(
      "manual_invoice_creation_requests_key_id_check",
      sql`${t.keyId} ~ '^[A-Z][A-Z0-9_]{2,31}$'`
    ),
    check(
      "manual_invoice_creation_requests_digest_check",
      sql`${t.requestDigest} ~ '^[A-Za-z0-9_-]{43}$'`
    ),
    check(
      "manual_invoice_creation_requests_completion_check",
      sql`${t.completedAt} is null or ${t.completedAt} >= ${t.claimedAt}`
    ),
  ]
);

export type ManualInvoiceCreationRequestRow =
  typeof manualInvoiceCreationRequests.$inferSelect;
