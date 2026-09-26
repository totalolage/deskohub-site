import type { DotyposCustomerId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { authUser } from "./auth";

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
