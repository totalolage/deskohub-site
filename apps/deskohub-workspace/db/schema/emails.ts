import type { DotyposCustomerId } from "@deskohub/dotypos";
import type {
  EmailDocument,
  EmailDraft,
  EmailId,
  EmailPreparationId,
  EmailValueName,
  EmailVersionId,
} from "@deskohub/workspace-admin-api";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { CampaignSendId } from "@/features/email-campaigns/campaign-identifiers";
import { instant } from "../instant";
import { sensitiveInstant } from "../sensitive-instant";
import { sensitiveText } from "../sensitive-text";
import { postgresUuidV7 } from "../uuid-v7";
import { emailCampaignRecipients } from "./email-campaigns";
import { quotedSqlList } from "./sql-list";

export const emails = pgTable(
  "emails",
  {
    id: text("id").primaryKey().default(postgresUuidV7).$type<EmailId>(),
    title: text("title").notNull(),
    draft: jsonb("draft").notNull().$type<EmailDraft>().default({}),
    archivedAt: instant("archived_at"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [check("emails_title_check", sql`btrim(${t.title}) <> ''`)]
);

/** Published content is insert-only, enforced by the migration's trigger. */
export const emailVersions = pgTable(
  "email_versions",
  {
    id: text("id").primaryKey().default(postgresUuidV7).$type<EmailVersionId>(),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id)
      .$type<EmailId>(),
    versionNumber: integer("version_number").notNull(),
    document: jsonb("document").notNull().$type<EmailDocument>(),
    requiredValueNames: text("required_value_names")
      .$type<EmailValueName>()
      .array()
      .notNull(),
    publishedAt: instant("published_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("email_versions_number_unique_idx").on(
      t.emailId,
      t.versionNumber
    ),
    check("email_versions_number_check", sql`${t.versionNumber} > 0`),
  ]
);

export type EmailPreparationState =
  | "selected"
  | "preparing"
  | "ready"
  | "skipped"
  | "failed";
/**
 * Why a preparation sealed without values; recorded atomically with its
 * terminal state. Temporary source or issuance failures never seal, so a
 * later retry can still prepare the recipient.
 */
export const emailPreparationOutcomeReasons = {
  skipped: ["missing-language", "missing-customer", "missing-value"],
  failed: [
    "customer-rejected",
    "customer-unauthorized",
    "discount-unavailable",
    "invalid-value",
  ],
} as const;
export type EmailPreparationSkipReason =
  (typeof emailPreparationOutcomeReasons.skipped)[number];
export type EmailPreparationFailureReason =
  (typeof emailPreparationOutcomeReasons.failed)[number];
export type EmailPreparationOutcomeReason =
  | EmailPreparationSkipReason
  | EmailPreparationFailureReason;

/**
 * A temporary source or issuance failure that outlasted preparation's
 * retries. It is recorded on the still-open preparation, so a later retry
 * can resume it.
 */
const emailPreparationUnavailableReasons = [
  "customer-unavailable",
  "issuance-unavailable",
] as const;
export type EmailPreparationUnavailableReason =
  (typeof emailPreparationUnavailableReasons)[number];

export type EmailDeliveryOutcome =
  | "pending"
  | "delivering"
  | "accepted"
  | "definitively-unsent"
  | "uncertain";

/** Identity survives delivery attempts; deletion is restricted to retain recovery evidence. */
export const emailPreparations = pgTable(
  "email_preparations",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<EmailPreparationId>(),
    sendId: text("send_id").notNull().$type<CampaignSendId>(),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    emailVersionId: text("email_version_id")
      .notNull()
      .references(() => emailVersions.id)
      .$type<EmailVersionId>(),
    locale: text("locale").notNull(),
    // The insert trigger copies these from the selected immutable version.
    requiredValueNames: text("required_value_names")
      .$type<EmailValueName>()
      .array()
      .notNull()
      .default([]),
    state: text("state")
      .notNull()
      .$type<EmailPreparationState>()
      .default("selected"),
    // Set once with skipped/failed; the value name identifies the definition that ended preparation.
    outcomeReason:
      text("outcome_reason").$type<EmailPreparationOutcomeReason>(),
    outcomeValueName: text("outcome_value_name").$type<EmailValueName>(),
    // The latest exhausted attempt; a later attempt may still seal the preparation.
    unavailableReason:
      text("unavailable_reason").$type<EmailPreparationUnavailableReason>(),
    unavailableValueName: text(
      "unavailable_value_name"
    ).$type<EmailValueName>(),
    unavailableAt: instant("unavailable_at"),
    deliveryOutcome: text("delivery_outcome")
      .notNull()
      .$type<EmailDeliveryOutcome>()
      .default("pending"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("email_preparations_recipient_unique_idx").on(
      t.sendId,
      t.dotyposCustomerId
    ),
    foreignKey({
      name: "email_preparations_recipient_fk",
      columns: [t.sendId, t.dotyposCustomerId],
      foreignColumns: [
        emailCampaignRecipients.sendId,
        emailCampaignRecipients.dotyposCustomerId,
      ],
    }),
    index("email_preparations_version_idx").on(t.emailVersionId),
    check(
      "email_preparations_state_check",
      sql`${t.state} in ('selected', 'preparing', 'ready', 'skipped', 'failed')`
    ),
    check(
      "email_preparations_outcome_check",
      sql`(case ${t.state} when 'skipped' then ${t.outcomeReason} is not null and ${t.outcomeReason} in (${quotedSqlList(emailPreparationOutcomeReasons.skipped)}) when 'failed' then ${t.outcomeReason} is not null and ${t.outcomeReason} in (${quotedSqlList(emailPreparationOutcomeReasons.failed)}) else ${t.outcomeReason} is null end) and (${t.outcomeValueName} is null or ${t.outcomeReason} is not null)`
    ),
    check(
      "email_preparations_unavailable_check",
      sql`(${t.unavailableReason} is null and ${t.unavailableValueName} is null and ${t.unavailableAt} is null) or (${t.unavailableReason} is not null and ${t.unavailableReason} in (${quotedSqlList(emailPreparationUnavailableReasons)}) and ${t.unavailableValueName} is not null and ${t.unavailableAt} is not null)`
    ),
    check(
      "email_preparations_delivery_check",
      sql`${t.deliveryOutcome} in ('pending', 'delivering', 'accepted', 'definitively-unsent', 'uncertain')`
    ),
  ]
);

export const emailValueSnapshots = pgTable(
  "email_value_snapshots",
  {
    preparationId: text("preparation_id")
      .notNull()
      .references(() => emailPreparations.id)
      .$type<EmailPreparationId>(),
    valueName: text("value_name").notNull().$type<EmailValueName>(),
    // JSON encoded through sensitiveText so generated customer data never enters query logs.
    value: sensitiveText("value").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.preparationId, t.valueName] }),
    check(
      "email_value_snapshots_json_check",
      sql`jsonb_typeof(${t.value}::jsonb) is not null`
    ),
  ]
);

export type EmailIssuanceState =
  | "reserved"
  | "issuing"
  | "issued"
  | "issuance-uncertain"
  | "cleanup-required"
  | "disabled";

export const emailDiscountIssuances = pgTable(
  "email_discount_issuances",
  {
    preparationId: text("preparation_id")
      .notNull()
      .references(() => emailPreparations.id)
      .$type<EmailPreparationId>(),
    valueName: text("value_name").notNull().$type<EmailValueName>(),
    recoveryIdentity: text("recovery_identity").notNull(),
    // Every effective provider parameter, including absolute expiry, is frozen before external work.
    parameters: sensitiveText("parameters").notNull(),
    state: text("state")
      .notNull()
      .$type<EmailIssuanceState>()
      .default("reserved"),
    code: sensitiveText("code"),
    expiresAt: sensitiveInstant("expires_at"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.preparationId, t.valueName] }),
    uniqueIndex("email_discount_issuances_recovery_unique_idx").on(
      t.recoveryIdentity
    ),
    check(
      "email_discount_issuances_state_check",
      sql`${t.state} in ('reserved', 'issuing', 'issued', 'issuance-uncertain', 'cleanup-required', 'disabled')`
    ),
    check(
      "email_discount_issuances_parameters_check",
      sql`jsonb_typeof(${t.parameters}::jsonb) = 'object'`
    ),
    check(
      "email_discount_issuances_result_check",
      sql`(${t.code} is null) = (${t.expiresAt} is null) and (${t.state} <> 'issued' or ${t.code} is not null)`
    ),
  ]
);

export type EmailRow = typeof emails.$inferSelect;
export type EmailVersionRow = typeof emailVersions.$inferSelect;
export type EmailPreparationRow = typeof emailPreparations.$inferSelect;
export type EmailDiscountIssuanceRow =
  typeof emailDiscountIssuances.$inferSelect;
