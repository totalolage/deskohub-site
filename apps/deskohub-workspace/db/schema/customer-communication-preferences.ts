import { sql } from "drizzle-orm";
import { check, pgTable, text } from "drizzle-orm/pg-core";
import type { Locale } from "@/features/i18n";
import inlangSettings from "../../project.inlang/settings.json" with {
  type: "json",
};
import { instant } from "../instant";
import { authUser } from "./auth";
import { quotedSqlList } from "./sql-list";

export const customerCommunicationPreferences = pgTable(
  "customer_communication_preferences",
  {
    customerAccountId: text("customer_account_id")
      .primaryKey()
      .references(() => authUser.id, { onDelete: "cascade" }),
    locale: text("locale").notNull().$type<Locale>(),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "customer_communication_preferences_locale_check",
      sql`${t.locale} in (${quotedSqlList(inlangSettings.locales)})`
    ),
  ]
);

export type CustomerCommunicationPreference =
  typeof customerCommunicationPreferences.$inferSelect;
