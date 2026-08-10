import { sql } from "drizzle-orm";
import { check, integer, pgTable } from "drizzle-orm/pg-core";

export const invoiceNumberCounters = pgTable(
  "invoice_number_counters",
  {
    numberingYear: integer("numbering_year").primaryKey(),
    lastSequence: integer("last_sequence").notNull(),
  },
  (t) => [
    check(
      "invoice_number_counters_year_check",
      sql`${t.numberingYear} between 2000 and 9999`
    ),
    check(
      "invoice_number_counters_sequence_check",
      sql`${t.lastSequence} between 1 and 999999`
    ),
  ]
);
