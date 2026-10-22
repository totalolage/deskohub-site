import type {
  AdministrationAssistantConnectionIdType,
  AdministrationCampaignAudienceInputType,
  AdministrationCampaignAudienceType,
  AdministrationCampaignCreateInputType,
  AdministrationCampaignDetailType,
  AdministrationCampaignIdType,
  AdministrationDiscountMutationResultType,
  AdministrationDiscountMutationType,
  AdministrationLegacyUsernameType,
  AdministrationReservationAccessGrantType,
  AdministrationReservationAccessMutationType,
  AdministrationStandaloneAccessCodeAttemptIdType,
  AdministrationStandaloneAccessCodeCreateInputType,
  AdministrationStandaloneAccessCodeResultType,
  AdministrationWorkspaceReservationIdType,
  CliBuildTargetType,
  CliMutationRequestIdType,
  CliSessionIdType,
} from "@deskohub/workspace-admin-api";
import { CLI_BUILD_TARGETS } from "@deskohub/workspace-admin-api";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { CliAuthenticationRequestId } from "@/features/admin-cli/cli-identifiers";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { administratorAssistantConnections } from "./administrator-assistant-connections";
import { authUser } from "./auth";
import { quotedSqlList } from "./sql-list";

export const cliSessions = pgTable(
  "cli_sessions",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<CliSessionIdType>(),
    /** The approving Basic-auth username of a session issued before accounts. */
    approvedBy: text("approved_by").$type<AdministrationLegacyUsernameType>(),
    approvedByAccountId: text("approved_by_account_id")
      .$type<CustomerAccountId>()
      .references(() => authUser.id, { onDelete: "set null" }),
    approvedByAccountEmail: text("approved_by_account_email"),
    tokenHash: text("token_hash").notNull(),
    clientName: text("client_name").notNull(),
    cliVersion: text("cli_version").notNull(),
    buildTarget: text("build_target").notNull().$type<CliBuildTargetType>(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    lastUsedAt: instant("last_used_at").notNull().default(sql`now()`),
    expiresAt: instant("expires_at"),
    revokedAt: instant("revoked_at"),
  },
  (t) => [
    uniqueIndex("cli_sessions_token_hash_unique_idx").on(t.tokenHash),
    index("cli_sessions_created_at_idx").on(t.createdAt),
    check(
      "cli_sessions_client_name_check",
      sql`char_length(btrim(${t.clientName})) between 1 and 80`
    ),
    check(
      "cli_sessions_cli_version_check",
      sql`char_length(${t.cliVersion}) between 1 and 32`
    ),
    check(
      "cli_sessions_build_target_check",
      sql`${t.buildTarget} in (${quotedSqlList(CLI_BUILD_TARGETS)})`
    ),
    check(
      "cli_sessions_token_hash_check",
      sql`${t.tokenHash} ~ '^[A-Za-z0-9_-]{43}$'`
    ),
    check(
      "cli_sessions_last_used_check",
      sql`${t.lastUsedAt} >= ${t.createdAt}`
    ),
    check(
      "cli_sessions_expiry_check",
      sql`${t.expiresAt} is null or ${t.expiresAt} > ${t.createdAt}`
    ),
    check(
      "cli_sessions_revoked_check",
      sql`${t.revokedAt} is null or ${t.revokedAt} >= ${t.createdAt}`
    ),
    check(
      "cli_sessions_approved_by_check",
      sql`${t.approvedBy} ~ '^[a-z0-9][a-z0-9._-]{0,79}$'`
    ),
    check(
      "cli_sessions_approved_by_account_check",
      sql`${t.approvedByAccountId} is null or (${t.approvedByAccountEmail} is not null and btrim(${t.approvedByAccountEmail}) <> '')`
    ),
    check(
      "cli_sessions_approver_check",
      sql`${t.approvedBy} is not null or ${t.approvedByAccountEmail} is not null`
    ),
  ]
);

export const cliAuthenticationRequests = pgTable(
  "cli_authentication_requests",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<CliAuthenticationRequestId>(),
    codeHash: text("code_hash").notNull(),
    challenge: text("challenge").notNull(),
    clientName: text("client_name").notNull(),
    cliVersion: text("cli_version").notNull(),
    buildTarget: text("build_target").notNull().$type<CliBuildTargetType>(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    expiresAt: instant("expires_at").notNull(),
    approvedAt: instant("approved_at"),
    /** The approving Basic-auth username of a request approved before accounts. */
    approvedBy: text("approved_by").$type<AdministrationLegacyUsernameType>(),
    approvedByAccountId: text("approved_by_account_id")
      .$type<CustomerAccountId>()
      .references(() => authUser.id, { onDelete: "set null" }),
    approvedByAccountEmail: text("approved_by_account_email"),
    grantToken: text("grant_token"),
    grantExpiresAt: instant("grant_expires_at"),
    sessionExpiresAt: instant("session_expires_at"),
    consumedAt: instant("consumed_at"),
    sessionId: text("session_id")
      .$type<CliSessionIdType>()
      .references(() => cliSessions.id),
  },
  (t) => [
    uniqueIndex("cli_authentication_requests_code_hash_unique_idx").on(
      t.codeHash
    ),
    index("cli_authentication_requests_expires_at_idx").on(t.expiresAt),
    uniqueIndex("cli_authentication_requests_session_unique_idx")
      .on(t.sessionId)
      .where(sql`${t.sessionId} is not null`),
    check(
      "cli_authentication_requests_expiry_check",
      sql`${t.expiresAt} > ${t.createdAt}`
    ),
    check(
      "cli_authentication_requests_code_hash_check",
      sql`${t.codeHash} ~ '^[A-Za-z0-9_-]{43}$'`
    ),
    check(
      "cli_authentication_requests_challenge_check",
      sql`${t.challenge} ~ '^[A-Za-z0-9_-]{43}$'`
    ),
    check(
      "cli_authentication_requests_grant_token_check",
      sql`${t.grantToken} is null or ${t.grantToken} ~ '^[A-Za-z0-9_-]{43}$'`
    ),
    check(
      "cli_authentication_requests_build_target_check",
      sql`${t.buildTarget} in (${quotedSqlList(CLI_BUILD_TARGETS)})`
    ),
    check(
      "cli_authentication_requests_approval_check",
      sql`(
        ${t.approvedAt} is null
        and ${t.approvedBy} is null
        and ${t.approvedByAccountId} is null
        and ${t.approvedByAccountEmail} is null
        and ${t.grantToken} is null
        and ${t.grantExpiresAt} is null
      ) or (
        ${t.approvedAt} is not null
        and ${t.grantExpiresAt} is not null
      )`
    ),
    check(
      "cli_authentication_requests_approved_by_account_check",
      sql`${t.approvedByAccountId} is null or (${t.approvedByAccountEmail} is not null and btrim(${t.approvedByAccountEmail}) <> '')`
    ),
    check(
      "cli_authentication_requests_session_expiry_check",
      sql`${t.sessionExpiresAt} is null or (
        ${t.approvedAt} is not null
        and ${t.sessionExpiresAt} > ${t.approvedAt}
      )`
    ),
    check(
      "cli_authentication_requests_consumption_check",
      sql`(
        ${t.consumedAt} is null
        and ${t.sessionId} is null
      ) or (
        ${t.consumedAt} is not null
        and ${t.sessionId} is not null
      )`
    ),
  ]
);

/**
 * The administration mutation ledger: one row per channel scope and request
 * ID, owned by exactly one CLI session or one assistant connection. The
 * name predates assistant connections.
 */
export const cliMutationRequests = pgTable(
  "cli_mutation_requests",
  {
    sessionId: text("session_id")
      .$type<CliSessionIdType>()
      .references(() => cliSessions.id, { onDelete: "cascade" }),
    assistantConnectionId: text("assistant_connection_id")
      .$type<AdministrationAssistantConnectionIdType>()
      .references(() => administratorAssistantConnections.id, {
        onDelete: "cascade",
      }),
    requestId: text("request_id").notNull().$type<CliMutationRequestIdType>(),
    mutation: jsonb("mutation").notNull().$type<CliStoredMutation>(),
    result: jsonb("result").$type<CliStoredMutationResult>(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    completedAt: instant("completed_at"),
  },
  (t) => [
    // Partial unique indexes rather than a key, so a deployment that inserts
    // with an untargeted `on conflict do nothing` keeps its claim semantics.
    uniqueIndex("cli_mutation_requests_session_request_idx")
      .on(t.sessionId, t.requestId)
      .where(sql`${t.sessionId} is not null`),
    uniqueIndex("cli_mutation_requests_assistant_connection_request_idx")
      .on(t.assistantConnectionId, t.requestId)
      .where(sql`${t.assistantConnectionId} is not null`),
    check(
      "cli_mutation_requests_owner_check",
      sql`num_nonnulls(${t.sessionId}, ${t.assistantConnectionId}) = 1`
    ),
    index("cli_mutation_requests_created_at_idx").on(t.createdAt),
    check(
      "cli_mutation_requests_request_id_check",
      sql`${t.requestId} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`
    ),
    check(
      "cli_mutation_requests_completion_check",
      sql`(
        ${t.result} is null
        and ${t.completedAt} is null
      ) or (
        ${t.result} is not null
        and ${t.completedAt} is not null
        and ${t.completedAt} >= ${t.createdAt}
      )`
    ),
  ]
);

export type CliStoredMutation =
  | AdministrationDiscountMutationType
  | {
      readonly kind: "reservation-access";
      readonly reservationId: AdministrationWorkspaceReservationIdType;
      readonly mutation: AdministrationReservationAccessMutationType;
    }
  | {
      readonly kind: "standalone-access-code";
      readonly request: AdministrationStandaloneAccessCodeCreateInputType;
      readonly providerCredentialRemovedAttemptId?: AdministrationStandaloneAccessCodeAttemptIdType;
    }
  | {
      readonly kind: "campaign-audience-create";
      readonly audience: AdministrationCampaignAudienceInputType;
    }
  | {
      readonly kind: "campaign-create";
      readonly campaign: AdministrationCampaignCreateInputType;
    }
  | {
      readonly kind: "campaign-duplicate";
      readonly campaignId: AdministrationCampaignIdType;
    };

export type CliStoredMutationResult =
  | AdministrationDiscountMutationResultType
  | AdministrationReservationAccessGrantType
  | AdministrationStandaloneAccessCodeResultType
  | AdministrationCampaignAudienceType
  | AdministrationCampaignDetailType;

export type CliSessionRow = typeof cliSessions.$inferSelect;
export type CliAuthenticationRequestRow =
  typeof cliAuthenticationRequests.$inferSelect;
