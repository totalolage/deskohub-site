import type { EmailDeliveryId } from "@deskohub/email";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  InvoiceEmailDeliveryAudience,
  InvoiceEmailDeliveryFailureCode,
  InvoiceEmailDeliveryState,
} from "@/features/accounting/invoice-email-delivery";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { invoices } from "./invoices";
import { quotedSqlList } from "./sql-list";

export const invoiceEmailDeliveryAudiences = ["customer", "internal"] as const;
export const invoiceEmailDeliveryStates = [
  "processing",
  "accepted",
  "failed",
] as const;

export const invoiceEmailDeliveries = pgTable(
  "invoice_email_deliveries",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    audience: text("audience").notNull().$type<InvoiceEmailDeliveryAudience>(),
    state: text("state").notNull().$type<InvoiceEmailDeliveryState>(),
    attemptCount: integer("attempt_count").notNull(),
    providerDeliveryId: text("provider_delivery_id").$type<EmailDeliveryId>(),
    failureCode: text("failure_code").$type<InvoiceEmailDeliveryFailureCode>(),
    acceptedAt: instant("accepted_at"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "invoice_email_deliveries_audience_check",
      sql`${t.audience} in (${quotedSqlList(invoiceEmailDeliveryAudiences)})`
    ),
    check(
      "invoice_email_deliveries_state_check",
      sql`${t.state} in (${quotedSqlList(invoiceEmailDeliveryStates)})`
    ),
    check(
      "invoice_email_deliveries_attempt_count_check",
      sql`${t.attemptCount} > 0`
    ),
    check(
      "invoice_email_deliveries_accepted_check",
      sql`${t.state} <> 'accepted' or (${t.providerDeliveryId} is not null and ${t.acceptedAt} is not null and ${t.failureCode} is null)`
    ),
    check(
      "invoice_email_deliveries_failed_check",
      sql`${t.state} <> 'failed' or ${t.failureCode} is not null`
    ),
    uniqueIndex("invoice_email_deliveries_invoice_audience_unique_idx").on(
      t.invoiceId,
      t.audience
    ),
    index("invoice_email_deliveries_state_updated_idx").on(
      t.state,
      t.updatedAt
    ),
  ]
);

export type InvoiceEmailDeliveryRow =
  typeof invoiceEmailDeliveries.$inferSelect;
