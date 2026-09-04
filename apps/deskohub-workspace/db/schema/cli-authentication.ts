import type {
  AdministrationActorUsernameType,
  AdministrationDiscountMutationResultType,
  AdministrationDiscountMutationType,
  AdministrationReservationAccessGrantType,
  AdministrationReservationAccessMutationType,
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
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { CliAuthenticationRequestId } from "@/features/admin-cli/cli-identifiers";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { quotedSqlList } from "./sql-list";

export const cliSessions = pgTable(
  "cli_sessions",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<CliSessionIdType>(),
    approvedBy: text("approved_by").$type<AdministrationActorUsernameType>(),
    tokenHash: text("token_hash").notNull(),
    clientName: text("client_name").notNull(),
    cliVersion: text("cli_version").notNull(),
    buildTarget: text("build_target").notNull().$type<CliBuildTargetType>(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    lastUsedAt: instant("last_used_at").notNull().default(sql`now()`),
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
      "cli_sessions_revoked_check",
      sql`${t.revokedAt} is null or ${t.revokedAt} >= ${t.createdAt}`
    ),
    check(
      "cli_sessions_approved_by_check",
      sql`${t.approvedBy} is null or char_length(btrim(${t.approvedBy})) between 1 and 80`
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
    approvedBy: text("approved_by").$type<AdministrationActorUsernameType>(),
    grantToken: text("grant_token"),
    grantExpiresAt: instant("grant_expires_at"),
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
        and ${t.grantToken} is null
        and ${t.grantExpiresAt} is null
      ) or (
        ${t.approvedAt} is not null
        and ${t.grantExpiresAt} is not null
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

export const cliMutationRequests = pgTable(
  "cli_mutation_requests",
  {
    sessionId: text("session_id")
      .notNull()
      .$type<CliSessionIdType>()
      .references(() => cliSessions.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull().$type<CliMutationRequestIdType>(),
    mutation: jsonb("mutation").notNull().$type<CliStoredMutation>(),
    result: jsonb("result").$type<CliStoredMutationResult>(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    completedAt: instant("completed_at"),
  },
  (t) => [
    primaryKey({
      name: "cli_mutation_requests_pk",
      columns: [t.sessionId, t.requestId],
    }),
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
    };

export type CliStoredMutationResult =
  | AdministrationDiscountMutationResultType
  | AdministrationReservationAccessGrantType
  | AdministrationStandaloneAccessCodeResultType;

export type CliSessionRow = typeof cliSessions.$inferSelect;
export type NewCliSessionRow = typeof cliSessions.$inferInsert;
export type CliAuthenticationRequestRow =
  typeof cliAuthenticationRequests.$inferSelect;
export type NewCliAuthenticationRequestRow =
  typeof cliAuthenticationRequests.$inferInsert;
export type CliMutationRequestRow = typeof cliMutationRequests.$inferSelect;
