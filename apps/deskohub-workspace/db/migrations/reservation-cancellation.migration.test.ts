import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

const applyCancellationMigration = async (database: PGlite) => {
  const migration = await Bun.file(
    new URL("./20260723114225_eminent_lake/migration.sql", import.meta.url)
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
    }>(`
      select
        id,
        reservation_state,
        payment_state,
        cancellation_claim_owner,
        cancellation_failure_disposition
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
      },
      {
        id: "pending-provider-paid",
        reservation_state: "cancelling",
        payment_state: "pending",
        cancellation_claim_owner: null,
        cancellation_failure_disposition: null,
      },
      {
        id: "pending-provider-terminal",
        reservation_state: "cancelling",
        payment_state: "pending",
        cancellation_claim_owner: null,
        cancellation_failure_disposition: null,
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
  });
});
