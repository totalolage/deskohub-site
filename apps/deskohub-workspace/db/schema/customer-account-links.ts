import type { DotyposCustomerId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { authUser } from "./auth";

/**
 * The legacy Dotypos link. `customer_accounts.dotypos_customer_id` replaced it
 * (#682); nothing reads or writes it, and it stays defined only so the
 * previous deployment, which still writes it, keeps working until the next
 * release drops it.
 */
export const customerAccountLinks = pgTable(
  "customer_account_links",
  {
    customerAccountId: text("customer_account_id")
      .primaryKey()
      .references(() => authUser.id, { onDelete: "cascade" }),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
  },
  (t) => [
    uniqueIndex("customer_account_links_dotypos_customer_unique_idx").on(
      t.dotyposCustomerId
    ),
    check(
      "customer_account_links_customer_check",
      sql`btrim(${t.dotyposCustomerId}) <> ''`
    ),
  ]
);
