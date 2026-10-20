import type { DotyposCustomerId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { instant } from "../instant";

/**
 * The durable Workspace customer account. Its id is the Better Auth user id,
 * and every `auth.user` row references its account, which sign-up creates
 * before the login. The account outlives the login, so records that name it,
 * such as reservation authors, survive account deletion: deletion sets
 * `deleted_at`, clears the Dotypos link, and leaves the row as a tombstone.
 * The account's personal data lives only in `auth` and Dotypos.
 *
 * `dotypos_customer_id` is the live account's own Dotypos customer, unique
 * across accounts; a tombstone holds none.
 */
export const customerAccounts = pgTable(
  "customer_accounts",
  {
    id: text("id").primaryKey().$type<CustomerAccountId>(),
    dotyposCustomerId: text("dotypos_customer_id").$type<DotyposCustomerId>(),
    deletedAt: instant("deleted_at"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("customer_accounts_dotypos_customer_unique_idx").on(
      t.dotyposCustomerId
    ),
    check(
      "customer_accounts_dotypos_customer_check",
      sql`btrim(${t.dotyposCustomerId}) <> ''`
    ),
  ]
);
