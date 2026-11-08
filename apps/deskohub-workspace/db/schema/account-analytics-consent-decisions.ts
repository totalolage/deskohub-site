import { sql } from "drizzle-orm";
import { check, index, pgTable, text } from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import {
  type AnalyticsConsentDecision,
  type AnalyticsConsentDecisionSource,
  analyticsConsentDecisionSources,
  analyticsConsentDecisions,
} from "@/features/legal/analytics-consent-decision";
import inlangSettings from "../../project.inlang/settings.json" with {
  type: "json",
};
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { authUser } from "./auth";
import { quotedSqlList } from "./sql-list";

/**
 * Every analytics consent decision an account made, appended and never
 * changed: whether it granted or withdrew analytics, the version of the
 * privacy notice it was given under, the notice's locale, when it was made,
 * and where it came from. The account's current decision is its latest by
 * `decided_at`. The rows belong to the login, so deleting the account's
 * `auth.user` row deletes them.
 */
export const accountAnalyticsConsentDecisions = pgTable(
  "account_analytics_consent_decisions",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    accountId: text("account_id")
      .notNull()
      .$type<CustomerAccountId>()
      .references(() => authUser.id, { onDelete: "cascade" }),
    decision: text("decision").notNull().$type<AnalyticsConsentDecision>(),
    /** The privacy notice version: its document hash, as legal evidence stores it. */
    documentHash: text("document_hash").notNull(),
    locale: text("locale").notNull().$type<Locale>(),
    decidedAt: instant("decided_at").notNull(),
    source: text("source").notNull().$type<AnalyticsConsentDecisionSource>(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    check(
      "account_analytics_consent_decisions_decision_check",
      sql`${t.decision} in (${quotedSqlList(analyticsConsentDecisions)})`
    ),
    check(
      "account_analytics_consent_decisions_locale_check",
      sql`${t.locale} in (${quotedSqlList(inlangSettings.locales)})`
    ),
    check(
      "account_analytics_consent_decisions_source_check",
      sql`${t.source} in (${quotedSqlList(analyticsConsentDecisionSources)})`
    ),
    index("account_analytics_consent_decisions_account_decided_idx").on(
      t.accountId,
      t.decidedAt.desc()
    ),
  ]
);
