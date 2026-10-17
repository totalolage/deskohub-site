import { sql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { instant } from "../instant";

/**
 * The durable Workspace customer account. Its id is the Better Auth user id
 * that created it, but it has no foreign key to `auth.user`, so records that
 * name the account, such as reservation authors, outlive the identity.
 * Account deletion sets `deleted_at` and leaves the row as a tombstone; the
 * account's personal data lives only in `auth` and Dotypos.
 */
export const customerAccounts = pgTable("customer_accounts", {
  id: text("id").primaryKey().$type<CustomerAccountId>(),
  deletedAt: instant("deleted_at"),
  createdAt: instant("created_at").notNull().default(sql`now()`),
});
