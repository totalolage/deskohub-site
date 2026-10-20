import type { DotyposCustomerId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { instant } from "../instant";

/**
 * The durable Workspace customer account. Its id is the Better Auth user id
 * that created it, but it has no foreign key to `auth.user`, so records that
 * name the account, such as reservation authors, outlive the identity.
 * Account deletion sets `deleted_at` and leaves the row as a tombstone; the
 * account's personal data lives only in `auth` and Dotypos.
 *
 * `dotypos_customer_id` is the account's own Dotypos customer. It mirrors
 * `customer_account_links`, which stays the link readers use until the
 * contract release (#682) folds the link into this row; deletion clears it.
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
