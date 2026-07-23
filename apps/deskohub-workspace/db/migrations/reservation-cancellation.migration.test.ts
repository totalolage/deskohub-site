import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

const applyCancellationMigration = async (database: PGlite) => {
  const migration = await Bun.file(
    new URL("./20260723121853_known_lorna_dane/migration.sql", import.meta.url)
  ).text();
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
};

describe("reservation cancellation ownership migration", () => {
  test("preserves legacy pending rows and remains compatible with old writers", async () => {
    const database = new PGlite();
    databases.push(database);
    await database.exec(`
      create table workspace_reservations (
        id text primary key,
        reservation_state text not null,
        payment_state text not null,
        updated_at timestamptz not null default now()
      );
      insert into workspace_reservations
        (id, reservation_state, payment_state, updated_at)
      values
        ('pending-provider-paid', 'cancelling', 'pending', now() - interval '10 minutes'),
        ('pending-provider-terminal', 'cancelling', 'pending', now() - interval '10 minutes'),
        ('legacy-failed', 'cancellation_failed', 'pending', now() - interval '10 minutes')
    `);

    await applyCancellationMigration(database);

    const preserved = await database.query<{
      id: string;
      reservation_state: string;
      payment_state: string;
      cancellation_claim_owner: string | null;
      cancellation_failure_disposition: string | null;
      cancellation_recovery_reason: string | null;
    }>(`
      select
        id,
        reservation_state,
        payment_state,
        cancellation_claim_owner,
        cancellation_failure_disposition,
        cancellation_recovery_reason
      from workspace_reservations
      order by id
    `);
    expect(preserved.rows).toEqual([
      {
        id: "legacy-failed",
        reservation_state: "cancellation_failed",
        payment_state: "pending",
        cancellation_claim_owner: null,
        cancellation_failure_disposition: "retryable",
        cancellation_recovery_reason: "retryable_failure",
      },
      {
        id: "pending-provider-paid",
        reservation_state: "cancelling",
        payment_state: "pending",
        cancellation_claim_owner: null,
        cancellation_failure_disposition: null,
        cancellation_recovery_reason: null,
      },
      {
        id: "pending-provider-terminal",
        reservation_state: "cancelling",
        payment_state: "pending",
        cancellation_claim_owner: null,
        cancellation_failure_disposition: null,
        cancellation_recovery_reason: null,
      },
    ]);

    await expect(
      database.exec(`
        insert into workspace_reservations
          (id, reservation_state, payment_state)
        values
          ('old-writer-ownerless-cancelling', 'cancelling', 'not_started')
      `)
    ).resolves.toBeDefined();
  });

  test("database-stamps the real old-writer cancellation update before new takeover", async () => {
    const database = new PGlite();
    databases.push(database);
    await database.exec(`
      create table workspace_reservations (
        id text primary key,
        reservation_state text not null,
        payment_state text not null,
        updated_at timestamptz not null default now()
      );
      insert into workspace_reservations
        (id, reservation_state, payment_state, updated_at)
      values
        ('old-writer-update', 'held', 'not_started', now())
    `);

    await applyCancellationMigration(database);

    await database.exec(`
      update workspace_reservations
      set
        reservation_state = 'cancelling',
        updated_at = now() - interval '30 minutes'
      where
        id = 'old-writer-update'
        and reservation_state in ('held', 'hold_expired', 'cancellation_failed')
        and payment_state <> 'paid'
    `);

    const [legacyClaim] = (
      await database.query<{ database_time_stamped: boolean }>(`
        select updated_at > now() - interval '1 minute' as database_time_stamped
        from workspace_reservations
        where id = 'old-writer-update'
      `)
    ).rows;
    expect(legacyClaim?.database_time_stamped).toBe(true);

    const takeover = await database.query<{ id: string }>(`
      update workspace_reservations
      set
        cancellation_claim_owner = 'new-worker',
        cancellation_claimed_at = now(),
        updated_at = now()
      where
        id = 'old-writer-update'
        and reservation_state = 'cancelling'
        and cancellation_claim_owner is null
        and cancellation_claimed_at is null
        and updated_at <= now() - interval '5 minutes'
      returning id
    `);
    expect(takeover.rows).toEqual([]);
  });

  test("backfills legacy failures without creating invalid half-leases", async () => {
    const database = new PGlite();
    databases.push(database);
    await database.exec(`
      create table workspace_reservations (
        id text primary key,
        reservation_state text not null,
        payment_state text not null,
        updated_at timestamptz not null default now()
      );
      insert into workspace_reservations
        (id, reservation_state, payment_state)
      values
        ('legacy-failed', 'cancellation_failed', 'not_started')
    `);

    await applyCancellationMigration(database);

    const [backfilled] = (
      await database.query<{
        cancellation_failure_disposition: string | null;
        cancellation_retry_at: Date | null;
      }>(`
        select cancellation_failure_disposition, cancellation_retry_at
        from workspace_reservations
        where id = 'legacy-failed'
      `)
    ).rows;
    expect(backfilled?.cancellation_failure_disposition).toBe("retryable");
    expect(backfilled?.cancellation_retry_at).not.toBeNull();

    await expect(
      database.exec(`
        update workspace_reservations
        set cancellation_claim_owner = 'worker', cancellation_claimed_at = null
        where id = 'legacy-failed'
      `)
    ).rejects.toBeDefined();
    await expect(
      database.exec(`
        update workspace_reservations
        set cancellation_recovery_reason = 'unknown_reason'
        where id = 'legacy-failed'
      `)
    ).rejects.toBeDefined();
  });
});
