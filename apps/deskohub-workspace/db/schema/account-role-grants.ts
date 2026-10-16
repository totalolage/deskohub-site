import { sql } from "drizzle-orm";
import { check, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import {
  type AccountRole,
  accountRoles,
} from "@/features/administrators/account-role";
import { instant } from "../instant";
import { authUser } from "./auth";
import { quotedSqlList } from "./sql-list";

export const accountRoleGrants = pgTable(
  "account_role_grants",
  {
    accountId: text("account_id")
      .notNull()
      .$type<CustomerAccountId>()
      .references(() => authUser.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<AccountRole>(),
    /** Null for grants bootstrapped from legacy Basic-auth administrators. */
    grantedByAccountId: text("granted_by_account_id")
      .$type<CustomerAccountId>()
      .references(() => authUser.id, { onDelete: "set null" }),
    grantedAt: instant("granted_at").notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.role] }),
    check(
      "account_role_grants_role_check",
      sql`${t.role} in (${quotedSqlList(accountRoles)})`
    ),
  ]
);
