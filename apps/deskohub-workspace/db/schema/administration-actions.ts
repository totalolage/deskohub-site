import type {
  AdministrationAssistantConnectionIdType,
  AdministrationOperationReference,
  CliSessionIdType,
} from "@deskohub/workspace-admin-api";
import { sql } from "drizzle-orm";
import { check, pgTable, text } from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import {
  type AdministrationActionOutcome,
  administrationActionOutcomes,
} from "@/features/admin-cli/administration-action";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { administratorAssistantConnections } from "./administrator-assistant-connections";
import { authUser } from "./auth";
import { cliSessions } from "./cli-authentication";
import { quotedSqlList } from "./sql-list";

/**
 * One administration API request that could change state: the operation,
 * who called it, through which channel, and how it ended. It stores no
 * request input or output. A row stays when its channel is revoked.
 */
export const administrationActions = pgTable(
  "administration_actions",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    operation: text("operation")
      .notNull()
      .$type<AdministrationOperationReference>(),
    outcome: text("outcome").notNull().$type<AdministrationActionOutcome>(),
    /** The declared error's tag, for a `failed` outcome. */
    failure: text("failure"),
    actorAccountId: text("actor_account_id")
      .$type<CustomerAccountId>()
      .references(() => authUser.id, { onDelete: "set null" }),
    /** The account's login email when it acted. */
    actorAccountEmail: text("actor_account_email").notNull(),
    cliSessionId: text("cli_session_id")
      .$type<CliSessionIdType>()
      .references(() => cliSessions.id),
    assistantConnectionId: text("assistant_connection_id")
      .$type<AdministrationAssistantConnectionIdType>()
      .references(() => administratorAssistantConnections.id),
    startedAt: instant("started_at").notNull().default(sql`now()`),
    finishedAt: instant("finished_at"),
  },
  (t) => [
    check(
      "administration_actions_operation_check",
      sql`btrim(${t.operation}) <> ''`
    ),
    check(
      "administration_actions_outcome_check",
      sql`${t.outcome} in (${quotedSqlList(administrationActionOutcomes)})`
    ),
    check(
      "administration_actions_failure_check",
      sql`(${t.outcome} = 'failed') = (${t.failure} is not null)`
    ),
    check(
      "administration_actions_finished_check",
      sql`(${t.outcome} = 'started') = (${t.finishedAt} is null)
        and (${t.finishedAt} is null or ${t.finishedAt} >= ${t.startedAt})`
    ),
    check(
      "administration_actions_email_check",
      sql`btrim(${t.actorAccountEmail}) <> ''`
    ),
    check(
      "administration_actions_channel_check",
      sql`num_nonnulls(${t.cliSessionId}, ${t.assistantConnectionId}) = 1`
    ),
  ]
);
