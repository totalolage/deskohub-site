import type { AdministrationAssistantConnectionIdType } from "@deskohub/workspace-admin-api";
import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { instant } from "../instant";
import { sensitiveText } from "../sensitive-text";
import { postgresUuidV7 } from "../uuid-v7";
import { authUser } from "./auth";

/**
 * An administrator's connection of one AI assistant, the assistant
 * counterpart of a CLI session: one per account and OAuth client, so it
 * outlives a disconnect and a reconnect. It holds no credential.
 */
export const administratorAssistantConnections = pgTable(
  "administrator_assistant_connections",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<AdministrationAssistantConnectionIdType>(),
    approvedByAccountId: text("approved_by_account_id")
      .$type<CustomerAccountId>()
      .references(() => authUser.id, { onDelete: "set null" }),
    /** The account's login email when the connection was first used. */
    approvedByAccountEmail: sensitiveText(
      "approved_by_account_email"
    ).notNull(),
    /** The assistant's OAuth client ID: its metadata document URL. */
    oauthClientId: text("oauth_client_id").notNull(),
    /** The name the assistant's metadata document published. */
    clientName: text("client_name").notNull(),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    lastUsedAt: instant("last_used_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("administrator_assistant_connections_account_client_idx").on(
      t.approvedByAccountId,
      t.oauthClientId
    ),
    check(
      "administrator_assistant_connections_email_check",
      sql`btrim(${t.approvedByAccountEmail}) <> ''`
    ),
    check(
      "administrator_assistant_connections_client_check",
      sql`btrim(${t.oauthClientId}) <> '' and btrim(${t.clientName}) <> ''`
    ),
    check(
      "administrator_assistant_connections_last_used_check",
      sql`${t.lastUsedAt} >= ${t.createdAt}`
    ),
  ]
);
