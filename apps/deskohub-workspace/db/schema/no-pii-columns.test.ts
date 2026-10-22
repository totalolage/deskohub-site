import { describe, expect, test } from "bun:test";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as authSchema from "./auth";
import * as workspaceSchema from "./index";

// Drizzle-kit generates migrations from exactly these two modules.
const tables = [...Object.values(workspaceSchema), ...Object.values(authSchema)]
  .filter((value): value is PgTable => is(value, PgTable))
  .map(getTableConfig);

const columns = tables.flatMap((table) =>
  table.columns.map((column) => ({
    id: `${table.schema ?? "public"}.${table.name}.${column.name}`,
    table: table.name,
    words: column.name.split("_"),
    sqlType: column.getSQLType(),
  }))
);

// Column-name word sequences that indicate customer contact data, billing
// identity, or raw provider payloads. A fragment matches a whole run of words,
// so "name" also covers "customer_name" and "company_name".
const forbiddenColumnFragments = [
  "name",
  "email",
  "phone",
  "customer_info",
  "message_json",
  "raw_payload",
  "raw_body",
  "provider_payload",
  "billing_address",
  "company_id",
  "postal_code",
  "vat_id",
].map((fragment) => fragment.split("_"));

const allowedColumns = new Map([
  // Better Auth owns the login email; AGENTS.md permits it in the auth schema.
  ["auth.user.email", "Better Auth login email"],
  ["auth.user.email_verified", "Better Auth login email verification flag"],
  // Better Auth requires the column, but the auth server rejects profile
  // names; the customer profile lives in Dotypos.
  ["auth.user.name", "Better Auth required column, kept empty"],
  // The passkey plugin's credential label: the authenticator's provider
  // name, or the label a customer gives their passkey to tell it apart.
  // Preview branches may inherit it under the Better Auth exception in the
  // root AGENTS.md preview-PII rule.
  [
    "auth.passkey.name",
    "Better Auth passkey label, covered by the preview-PII exception",
  ],
  // The display name an AI agent's provider publishes in its Client ID
  // Metadata Document, such as "Claude"; not customer data.
  ["auth.oauth_client.name", "published AI agent client name"],
  // The label of the customer MCP server as an OAuth protected resource.
  ["auth.oauth_resource.name", "OAuth protected resource label"],
  // An email delivery identifier, explicitly allowed by the No-PII policy.
  [
    "public.workspace_reservations.active_customer_email_delivery_id",
    "customer email delivery ID",
  ],
  // The en-US/cs-CZ locale retained for one customer email generation.
  [
    "public.workspace_reservations.active_customer_email_delivery_locale",
    "customer email delivery locale",
  ],
  // An administrator's login email recorded as provenance on what they did,
  // so it stays readable after the account is deleted.
  [
    "public.cli_sessions.approved_by_account_email",
    "administrator login-email snapshot",
  ],
  [
    "public.cli_authentication_requests.approved_by_account_email",
    "administrator login-email snapshot",
  ],
  [
    "public.manual_invoice_actors.actor_account_email",
    "administrator login-email snapshot",
  ],
  [
    "public.standalone_access_code_attempt_events.actor_account_email",
    "administrator login-email snapshot",
  ],
  [
    "public.administrator_assistant_connections.approved_by_account_email",
    "administrator login-email snapshot",
  ],
  [
    "public.administration_actions.actor_account_email",
    "administrator login-email snapshot",
  ],
  // Operator-side labels, not customer data.
  ["public.cli_sessions.client_name", "dhw CLI client label"],
  ["public.cli_authentication_requests.client_name", "dhw CLI client label"],
  // The name an AI assistant's provider publishes, such as "Claude".
  [
    "public.administrator_assistant_connections.client_name",
    "published AI assistant client name",
  ],
  [
    "public.standalone_access_code_attempt_events.name",
    "operator-entered access code label",
  ],
  [
    "public.reservation_access_grants.access_name",
    "Igloohome credential label built from the grant ID",
  ],
]);

const containsWordRun = (
  words: readonly string[],
  fragment: readonly string[]
) =>
  words.some((_, start) =>
    fragment.every((word, offset) => words[start + offset] === word)
  );

describe("database schema no-PII persistence", () => {
  test("has no customer contact, billing, or raw payload columns", () => {
    const violations = columns
      .filter(({ words }) =>
        forbiddenColumnFragments.some((fragment) =>
          containsWordRun(words, fragment)
        )
      )
      .map(({ id }) => id)
      .filter((id) => !allowedColumns.has(id));

    expect(violations).toEqual([]);
  });

  test("keeps every allowlisted exception backed by a real column", () => {
    const columnIds = columns.map(({ id }) => id);

    for (const allowed of allowedColumns.keys()) {
      expect(columnIds).toContain(allowed);
    }
  });

  test("stores confidential accounting documents only as pgcrypto ciphertext", () => {
    const binaryColumns = columns
      .filter(({ sqlType }) => sqlType === "bytea")
      .map(({ id }) => id)
      .toSorted();

    expect(binaryColumns).toEqual([
      "public.accounting_document_snapshots.encrypted_snapshot",
      "public.invoices.encrypted_document",
    ]);
  });

  test("keeps structured payloads out of ciphertext, recovery, and delivery ledgers", () => {
    const payloadFreeTables = new Set([
      "accounting_document_snapshots",
      "invoices",
      "invoice_email_deliveries",
      "late_payment_recoveries",
    ]);
    const structuredColumns = columns
      .filter(
        ({ table, sqlType }) =>
          payloadFreeTables.has(table) && ["json", "jsonb"].includes(sqlType)
      )
      .map(({ id }) => id);

    expect(tables.map(({ name }) => name)).toEqual(
      expect.arrayContaining([...payloadFreeTables])
    );
    expect(structuredColumns).toEqual([]);
  });
});
