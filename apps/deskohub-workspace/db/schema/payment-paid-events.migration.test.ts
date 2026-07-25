import { describe, expect, test } from "bun:test";

describe("payment paid event migration contract", () => {
  test("composes from the committed current-main internal-payment snapshot", async () => {
    const predecessor = await Bun.file(
      new URL(
        "../migrations/20260724235932_living_sentry/snapshot.json",
        import.meta.url
      )
    ).json();
    const paymentSnapshot = await Bun.file(
      new URL(
        "../migrations/20260725004304_payment_admission_settlement/snapshot.json",
        import.meta.url
      )
    ).json();

    expect(paymentSnapshot.prevIds).toEqual([predecessor.id]);
  });

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
    expect(migration).toContain(
      'CREATE TRIGGER "payment_evidence_conflicts_materialize"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "payment_attempts_guard_provider_evidence_conflict"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "payment_attempts_reject_provider_evidence_conflicted_settlement"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "workspace_reservations_reject_provider_evidence_conflicted_settlement"'
    );
    expect(migration).toContain("deskohub.verified_v2_terminal_settlement");
    expect(migration).toContain('OLD."admission_version" = 2');
    expect(migration).toContain("attempt.\"state\" IN ('created', 'pending')");
    expect(migration).toContain("OLD.\"state\" IN ('created', 'pending')");
    expect(migration).toContain('CREATE TABLE "payment_evidence_conflicts"');
    expect(migration).toContain(
      '"active_payment_evidence_conflicted" boolean DEFAULT false NOT NULL'
    );
    expect(migration).toContain(
      "NEW.\"reservation_state\" IN (\n      'hold_expired',\n      'cancelling',\n      'cancelled'"
    );
    expect(migration).toContain(
      "provider evidence conflict rejects active attempt replacement"
    );
    expect(migration).toContain(
      'reservation."id" = attempt."workspace_reservation_id"'
    );
    expect(migration).toContain('"payment_reconciliation_claim_id" text');
    expect(migration).toContain(
      '"payment_reconciliation_claim_expires_at" timestamp with time zone'
    );
    expect(migration).toContain(
      "reservation is owned by authoritative provider reconciliation"
    );
  });
});
