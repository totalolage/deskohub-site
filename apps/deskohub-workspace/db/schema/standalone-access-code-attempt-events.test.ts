import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { standaloneAccessCodeAttemptEvents } from "./standalone-access-code-attempt-events";

const safeColumnNames = [
  "id",
  "attempt_id",
  "event_kind",
  "actor",
  "source",
  "name",
  "device_id",
  "starts_at_local",
  "ends_at_local",
  "starts_at",
  "ends_at",
  "variance",
  "provider_credential_id",
  "provider_status_code",
  "failure_code",
  "occurred_at",
  "created_at",
];

describe("standalone access-code attempt event audit schema", () => {
  test("stores safe metadata only without any PIN or payload column", () => {
    const config = getTableConfig(standaloneAccessCodeAttemptEvents);
    expect(config.columns.map(({ name }) => name).sort()).toEqual(
      [...safeColumnNames].sort()
    );
    for (const column of config.columns) {
      expect(column.name).not.toMatch(/pin|secret|payload|access_code/);
      expect(column.columnType).not.toBe("JSONB");
    }
  });

  test("enforces the closed event, source, variance, and failure-code vocabularies", () => {
    const config = getTableConfig(standaloneAccessCodeAttemptEvents);
    expect(config.checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "standalone_access_code_attempt_events_attempt_id_check",
        "standalone_access_code_attempt_events_event_kind_check",
        "standalone_access_code_attempt_events_source_check",
        "standalone_access_code_attempt_events_variance_check",
        "standalone_access_code_attempt_events_name_check",
        "standalone_access_code_attempt_events_actor_check",
        "standalone_access_code_attempt_events_interval_check",
        "standalone_access_code_attempt_events_started_check",
        "standalone_access_code_attempt_events_created_check",
        "standalone_access_code_attempt_events_failure_check",
        "standalone_access_code_attempt_events_failure_code_check",
      ])
    );
    const statusCodeColumn = config.columns.find(
      ({ name }) => name === "provider_status_code"
    );
    expect(statusCodeColumn?.notNull).toBe(false);
    const failureCodeColumn = config.columns.find(
      ({ name }) => name === "failure_code"
    );
    expect(failureCodeColumn?.notNull).toBe(false);
  });

  test("allows at most one started, terminal, and reconciled event per attempt", () => {
    const config = getTableConfig(standaloneAccessCodeAttemptEvents);
    const startedIndex = config.indexes.find(
      ({ config: index }) =>
        index.name ===
        "standalone_access_code_attempt_events_started_unique_idx"
    )?.config;
    const terminalIndex = config.indexes.find(
      ({ config: index }) =>
        index.name ===
        "standalone_access_code_attempt_events_terminal_unique_idx"
    )?.config;
    const reconciledIndex = config.indexes.find(
      ({ config: index }) =>
        index.name ===
        "standalone_access_code_attempt_events_reconciled_unique_idx"
    )?.config;

    expect(startedIndex).toMatchObject({ unique: true });
    expect(startedIndex?.where).toBeDefined();
    expect(terminalIndex).toMatchObject({ unique: true });
    expect(terminalIndex?.where).toBeDefined();
    expect(reconciledIndex).toMatchObject({ unique: true });
    expect(reconciledIndex?.where).toBeDefined();
  });

  test("creates the append-only event table in one migration", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260904061533_outstanding_nico_minoru/migration.sql",
        import.meta.url
      )
    ).text();

    expect(migration).toContain(
      'CREATE TABLE "standalone_access_code_attempt_events"'
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "standalone_access_code_attempt_events_started_unique_idx" ON "standalone_access_code_attempt_events" ("attempt_id") WHERE "event_kind" = \'started\''
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "standalone_access_code_attempt_events_terminal_unique_idx" ON "standalone_access_code_attempt_events" ("attempt_id") WHERE "event_kind" in (\'created\', \'rejected\', \'ambiguous\')'
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "standalone_access_code_attempt_events_reconciled_unique_idx" ON "standalone_access_code_attempt_events" ("attempt_id") WHERE "event_kind" = \'reconciled\''
    );
    expect(migration).toContain(
      "\"event_kind\" in ('started', 'created', 'rejected', 'ambiguous', 'reconciled')"
    );
    expect(migration).toContain(
      "\"attempt_id\" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"
    );
    expect(migration).toContain("\"source\" in ('admin-ui', 'dhw-cli')");
    expect(migration).toContain(
      "\"failure_code\" in ('standalone_provider_rejected', 'standalone_provider_ambiguous', 'standalone_attempt_stale')"
    );
    expect(migration).toContain('"variance" in (2, 3)');
    expect(migration).not.toMatch(/pin/i);
  });
});
