import type { DotyposCustomerId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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
 *
 * `legacy` marks an existing customer's account: #764's backfill gave every
 * customer with older reservations a silent login, so the account was in
 * fact created before records began and `created_at` is only when the
 * backfill ran. A legacy account never counts as a new one. Nothing creates
 * legacy accounts any more, so every other account is a sign-up.
 *
 * `review` marks an app-directory review account: a synthetic login on the
 * reserved test domain that reviewers sign in to with a password. Its
 * bookings run in the review sandbox, so it never gets a Dotypos customer;
 * the check enforces that for every write.
 */
export const customerAccounts = pgTable(
  "customer_accounts",
  {
    id: text("id").primaryKey().$type<CustomerAccountId>(),
    dotyposCustomerId: text("dotypos_customer_id").$type<DotyposCustomerId>(),
    deletedAt: instant("deleted_at"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    legacy: boolean("legacy").notNull().default(false),
    review: boolean("review").notNull().default(false),
  },
  (t) => [
    uniqueIndex("customer_accounts_dotypos_customer_unique_idx").on(
      t.dotyposCustomerId
    ),
    check(
      "customer_accounts_dotypos_customer_check",
      sql`btrim(${t.dotyposCustomerId}) <> ''`
    ),
    check(
      "customer_accounts_review_without_dotypos_customer_check",
      sql`not ${t.review} or ${t.dotyposCustomerId} is null`
    ),
  ]
);
