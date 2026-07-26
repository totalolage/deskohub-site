import { describe, expect, test } from "bun:test";

const migrationUrl = new URL(
  "../migrations/20260725201938_paid_fulfillment_recovery/migration.sql",
  import.meta.url
);
const snapshotUrl = new URL(
  "../migrations/20260725201938_paid_fulfillment_recovery/snapshot.json",
  import.meta.url
);
const predecessorUrl = new URL(
  "../migrations/20260724235932_living_sentry/snapshot.json",
  import.meta.url
);

describe("paid fulfillment recovery migration", () => {
  test("composes from current origin/main and preserves the paid-event contract", async () => {
    const predecessor = await Bun.file(predecessorUrl).json();
    const snapshot = await Bun.file(snapshotUrl).json();
    const migration = await Bun.file(migrationUrl).text();

    expect(snapshot.prevIds).toEqual([predecessor.id]);
    expect(migration).toContain('CREATE TABLE "payment_paid_events"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "payment_paid_events_attempt_unique_idx"'
    );
    expect(migration).toContain(
      'CREATE INDEX "payment_paid_events_reservation_idx"'
    );
  });

  test("installs atomic mixed-version enqueue, backfill, and a separate lease", async () => {
    const migration = await Bun.file(migrationUrl).text();

    expect(migration).toContain(
      'CREATE TRIGGER "workspace_reservations_enqueue_paid_event"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "payment_attempts_enqueue_paid_event"'
    );
    expect(migration).toContain(
      'ON CONFLICT ("payment_attempt_id") DO NOTHING'
    );
    expect(migration).toContain('CREATE TABLE "paid_fulfillment_jobs"');
    expect(migration).toContain('"lease_owner_id" text');
    expect(migration).toContain('"claimed_at" timestamp with time zone');
    expect(migration).toContain(
      '"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL'
    );
    expect(migration).toContain(
      'CONSTRAINT "paid_fulfillment_jobs_attempt_count_check"'
    );
  });

  test("contains only identifiers, lifecycle state, timestamps, and normalized codes", async () => {
    const migration = (await Bun.file(migrationUrl).text()).toLowerCase();
    const forbiddenColumnFragments = [
      '"email"',
      '"phone"',
      '"recipient"',
      '"address"',
      '"message"',
      '"body"',
      '"payload"',
      '"token"',
      '"secret"',
      '"access_code"',
      '"credential"',
      '"raw_',
    ];

    for (const fragment of forbiddenColumnFragments) {
      expect(migration).not.toContain(fragment);
    }
  });
});
