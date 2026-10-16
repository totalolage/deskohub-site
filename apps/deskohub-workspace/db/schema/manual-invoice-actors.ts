import { sql } from "drizzle-orm";
import { check, pgTable, text } from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import { authUser } from "./auth";
import { invoices } from "./invoices";

/**
 * The administrator account that issued a manual invoice. Issued invoices are
 * immutable, so the account actor lives beside the invoice rather than in it.
 */
export const manualInvoiceActors = pgTable(
  "manual_invoice_actors",
  {
    invoiceId: text("invoice_id")
      .primaryKey()
      .$type<InvoiceId>()
      .references(() => invoices.id),
    actorAccountId: text("actor_account_id")
      .$type<CustomerAccountId>()
      .references(() => authUser.id, { onDelete: "set null" }),
    /** The account's login email when it was recorded. */
    actorAccountEmail: text("actor_account_email").notNull(),
  },
  (t) => [
    check(
      "manual_invoice_actors_email_check",
      sql`btrim(${t.actorAccountEmail}) <> ''`
    ),
  ]
);
