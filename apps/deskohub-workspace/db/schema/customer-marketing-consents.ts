import { sql } from "drizzle-orm";
import { check, pgTable, text } from "drizzle-orm/pg-core";
import type { Locale } from "@/features/i18n";
import inlangSettings from "../../project.inlang/settings.json" with {
  type: "json",
};
import { instant } from "../instant";
import { quotedSqlList } from "./sql-list";

export const customerMarketingConsents = pgTable(
  "customer_marketing_consents",
  {
    dotyposCustomerId: text("dotypos_customer_id").primaryKey(),
    documentHash: text("document_hash").notNull(),
    locale: text("locale").notNull().$type<Locale>(),
    grantedAt: instant("granted_at").notNull(),
    withdrawnAt: instant("withdrawn_at"),
  },
  (t) => [
    check(
      "customer_marketing_consents_customer_check",
      sql`btrim(${t.dotyposCustomerId}) <> ''`
    ),
    check(
      "customer_marketing_consents_locale_check",
      sql`${t.locale} in (${quotedSqlList(inlangSettings.locales)})`
    ),
    check(
      "customer_marketing_consents_withdrawal_check",
      sql`${t.withdrawnAt} is null or ${t.withdrawnAt} >= ${t.grantedAt}`
    ),
  ]
);

export type CustomerMarketingConsent =
  typeof customerMarketingConsents.$inferSelect;
