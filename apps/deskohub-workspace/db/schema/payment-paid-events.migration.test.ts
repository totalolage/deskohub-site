import { describe, expect, test } from "bun:test";

describe("payment paid event migration contract", () => {
  test("installs both mixed-version triggers and the idempotent backfill", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260725004304_payment_admission_settlement/migration.sql",
        import.meta.url
      )
    ).text();

    expect(migration).toContain(
      'CREATE TRIGGER "workspace_reservations_enqueue_paid_event"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "payment_attempts_enqueue_paid_event"'
    );
    expect(migration).toContain(
      'reservation."active_payment_attempt_id" = attempt."id"'
    );
    expect(migration).toContain(
      'ON CONFLICT ("payment_attempt_id") DO NOTHING'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "payment_attempts_guard_unverified_v2_terminal"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "workspace_reservations_guard_unverified_v2_terminal"'
    );
    expect(migration).toContain("deskohub.verified_v2_terminal_settlement");
    expect(migration).toContain('OLD."admission_version" = 2');
    expect(migration).toContain("attempt.\"state\" IN ('created', 'pending')");
    expect(migration).toContain("OLD.\"state\" IN ('created', 'pending')");
    expect(migration).toContain('CREATE TABLE "payment_evidence_conflicts"');
  });
});
