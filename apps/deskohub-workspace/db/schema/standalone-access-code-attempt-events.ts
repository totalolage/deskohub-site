import type { IgloohomeDeviceId } from "@deskohub/igloohome";
import type {
  AdministrationActorUsername,
  AdministrationProviderCredentialId,
  AdministrationStandaloneAccessCodeAttemptId,
  AdministrationStandaloneAccessCodeName,
  AdministrationWorkspaceSiteLocalWholeHourDateTime,
} from "@deskohub/workspace-admin-api";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { StandaloneAccessCodeAttemptEventId } from "@/features/access-codes/standalone-access-code";
import {
  type StandaloneAccessCodeProviderVariance,
  type StandaloneAccessCodeSource,
  standaloneAccessCodeAttemptEventKinds,
  standaloneAccessCodeFailureCodes,
  standaloneAccessCodeSources,
  standaloneAccessCodeTerminalEventKinds,
} from "@/features/access-codes/standalone-access-code";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { quotedSqlList } from "./sql-list";

export const standaloneAccessCodeAttemptEvents = pgTable(
  "standalone_access_code_attempt_events",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<StandaloneAccessCodeAttemptEventId>(),
    attemptId: text("attempt_id")
      .notNull()
      .$type<AdministrationStandaloneAccessCodeAttemptId>(),
    eventKind: text("event_kind")
      .notNull()
      .$type<(typeof standaloneAccessCodeAttemptEventKinds)[number]>(),
    actor: text("actor").notNull().$type<AdministrationActorUsername>(),
    source: text("source").notNull().$type<StandaloneAccessCodeSource>(),
    name: text("name")
      .notNull()
      .$type<AdministrationStandaloneAccessCodeName>(),
    deviceId: text("device_id").notNull().$type<IgloohomeDeviceId>(),
    startsAtLocal: text("starts_at_local")
      .notNull()
      .$type<AdministrationWorkspaceSiteLocalWholeHourDateTime>(),
    endsAtLocal: text("ends_at_local")
      .notNull()
      .$type<AdministrationWorkspaceSiteLocalWholeHourDateTime>(),
    startsAt: instant("starts_at").notNull(),
    endsAt: instant("ends_at").notNull(),
    variance: integer("variance")
      .notNull()
      .$type<StandaloneAccessCodeProviderVariance>(),
    providerCredentialId: text(
      "provider_credential_id"
    ).$type<AdministrationProviderCredentialId>(),
    providerStatusCode: integer("provider_status_code"),
    failureCode:
      text("failure_code").$type<
        (typeof standaloneAccessCodeFailureCodes)[number]
      >(),
    occurredAt: instant("occurred_at").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("standalone_access_code_attempt_events_started_unique_idx")
      .on(t.attemptId)
      .where(sql`${t.eventKind} = 'started'`),
    uniqueIndex("standalone_access_code_attempt_events_terminal_unique_idx")
      .on(t.attemptId)
      .where(
        sql`${t.eventKind} in (${quotedSqlList(standaloneAccessCodeTerminalEventKinds)})`
      ),
    uniqueIndex("standalone_access_code_attempt_events_reconciled_unique_idx")
      .on(t.attemptId)
      .where(sql`${t.eventKind} = 'reconciled'`),
    index("standalone_access_code_attempt_events_window_idx").on(
      t.deviceId,
      t.startsAt,
      t.endsAt
    ),
    check(
      "standalone_access_code_attempt_events_attempt_id_check",
      sql`${t.attemptId} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`
    ),
    check(
      "standalone_access_code_attempt_events_event_kind_check",
      sql`${t.eventKind} in (${quotedSqlList(standaloneAccessCodeAttemptEventKinds)})`
    ),
    check(
      "standalone_access_code_attempt_events_source_check",
      sql`${t.source} in (${quotedSqlList(standaloneAccessCodeSources)})`
    ),
    check(
      "standalone_access_code_attempt_events_variance_check",
      sql`${t.variance} in (2, 3)`
    ),
    check(
      "standalone_access_code_attempt_events_name_check",
      sql`char_length(${t.name}) between 1 and 60`
    ),
    check(
      "standalone_access_code_attempt_events_actor_check",
      sql`char_length(${t.actor}) between 1 and 80`
    ),
    check(
      "standalone_access_code_attempt_events_interval_check",
      sql`${t.endsAt} > ${t.startsAt}`
    ),
    check(
      "standalone_access_code_attempt_events_started_check",
      sql`${t.eventKind} <> 'started' or (${t.providerCredentialId} is null and ${t.providerStatusCode} is null and ${t.failureCode} is null)`
    ),
    check(
      "standalone_access_code_attempt_events_created_check",
      sql`${t.eventKind} <> 'created' or (${t.providerCredentialId} is not null and ${t.providerStatusCode} is null and ${t.failureCode} is null)`
    ),
    check(
      "standalone_access_code_attempt_events_failure_check",
      sql`(${t.eventKind} <> 'rejected' and ${t.eventKind} <> 'ambiguous') or (${t.providerCredentialId} is null and ${t.failureCode} is not null)`
    ),
    check(
      "standalone_access_code_attempt_events_failure_code_check",
      sql`${t.failureCode} is null or ${t.failureCode} in (${quotedSqlList(standaloneAccessCodeFailureCodes)})`
    ),
  ]
);

export type StandaloneAccessCodeAttemptEventRow =
  typeof standaloneAccessCodeAttemptEvents.$inferSelect;
export type NewStandaloneAccessCodeAttemptEventRow =
  typeof standaloneAccessCodeAttemptEvents.$inferInsert;
