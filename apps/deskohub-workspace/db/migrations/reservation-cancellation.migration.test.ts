import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

const databases: PGlite[] = [];
const cancellationMigrationUrl = new URL(
  "./20260724160212_reservation_cancellation_ownership_rollout/migration.sql",
  import.meta.url
);

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

const applyCancellationMigration = async (database: PGlite) => {
  const migration = await Bun.file(cancellationMigrationUrl).text();
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
};

describe("reservation cancellation ownership migration", () => {
  const prepareRolloutDatabase = async () => {
    const database = new PGlite();
    databases.push(database);
    await database.exec(`
      create table workspace_reservations (
        id text primary key,
        reservation_state text not null,
        payment_state text not null,
        dotypos_reservation_id text,
        updated_at timestamptz not null default now(),
        constraint workspace_reservations_reservation_state_check
          check (reservation_state in (
            'draft',
            'creating_hold',
            'held',
            'hold_expired',
            'confirming',
            'confirmed',
            'cancelling',
            'cancelled',
            'cancellation_failed'
          ))
      );
      insert into workspace_reservations
        (id, reservation_state, payment_state, dotypos_reservation_id)
      values
        ('rollout-reservation', 'held', 'not_started', 'synthetic-provider')
    `);
    await applyCancellationMigration(database);
    return database;
  };

  const newWorkerClaim = (database: PGlite) =>
    database.query<{ id: string }>(`
      update workspace_reservations
      set
        reservation_state = 'cancellation_claimed',
        cancellation_claim_owner = 'synthetic-new-worker',
        cancellation_claimed_at = now(),
        cancellation_failure_disposition = null,
        cancellation_retry_at = null,
        updated_at = now()
      where
        id = 'rollout-reservation'
        and (
          reservation_state in ('held', 'hold_expired')
          or (
            reservation_state = 'cancellation_failed'
            and cancellation_failure_disposition = 'retryable'
            and cancellation_retry_at <= now()
          )
        )
        and payment_state <> 'paid'
      returning id
    `);

  const oldWorkerClaim = (database: PGlite) =>
    database.query<{ id: string; reservation_state: string }>(`
      update workspace_reservations
      set
        reservation_state = 'cancelling',
        cancellation_claim_owner = 'synthetic-old-worker',
        cancellation_claimed_at = now(),
        cancellation_failure_disposition = null,
        cancellation_retry_at = null,
        updated_at = now()
      where
        id = 'rollout-reservation'
        and reservation_state in ('held', 'hold_expired', 'cancellation_failed')
        and payment_state <> 'paid'
      returning id, reservation_state
    `);

  test("keeps an old worker outside the provider boundary when the new worker claims first", async () => {
    const database = await prepareRolloutDatabase();

    expect((await newWorkerClaim(database)).rows).toHaveLength(1);
    expect((await oldWorkerClaim(database)).rows).toEqual([]);
    const [stored] = (
      await database.query<{
        cancellation_claim_owner: string | null;
        reservation_state: string;
      }>(`
        select reservation_state, cancellation_claim_owner
        from workspace_reservations
        where id = 'rollout-reservation'
      `)
    ).rows;

    expect(stored).toEqual({
      reservation_state: "cancellation_claimed",
      cancellation_claim_owner: "synthetic-new-worker",
    });
  });

  test("rejects the old owner-stamped claim before its provider boundary when it runs first", async () => {
    const database = await prepareRolloutDatabase();

    await expect(oldWorkerClaim(database)).rejects.toMatchObject({
      code: "23514",
    });
    const [afterRejectedOldClaim] = (
      await database.query<{
        cancellation_claim_owner: string | null;
        cancellation_claimed_at: Date | null;
        reservation_state: string;
      }>(`
        select
          reservation_state,
          cancellation_claim_owner,
          cancellation_claimed_at
        from workspace_reservations
        where id = 'rollout-reservation'
      `)
    ).rows;
    expect(afterRejectedOldClaim).toEqual({
      reservation_state: "held",
      cancellation_claim_owner: null,
      cancellation_claimed_at: null,
    });

    expect((await newWorkerClaim(database)).rows).toHaveLength(1);
  });

  test("upgrades an already-applied draft ownership migration without losing claims", async () => {
    const database = new PGlite();
    databases.push(database);
    await database.exec(`
      create table workspace_reservations (
        id text primary key,
        reservation_state text not null,
        payment_state text not null,
        dotypos_reservation_id text,
        cancellation_claim_owner text,
        cancellation_claimed_at timestamptz,
        cancellation_failure_disposition text,
        cancellation_retry_at timestamptz,
        cancellation_recovery_reason text,
        updated_at timestamptz not null default now(),
        constraint workspace_reservations_reservation_state_check
          check (reservation_state in (
            'draft',
            'creating_hold',
            'held',
            'hold_expired',
            'confirming',
            'confirmed',
            'cancelling',
            'cancelled',
            'cancellation_failed'
          )),
        constraint workspace_reservations_cancellation_claim_check check (
          (
            cancellation_claim_owner is null
            and cancellation_claimed_at is null
          ) or (
            cancellation_claim_owner is not null
            and cancellation_claimed_at is not null
          )
        ),
        constraint workspace_reservations_cancellation_failure_check check (
          (
            cancellation_failure_disposition is null
            and cancellation_retry_at is null
          ) or (
            cancellation_failure_disposition = 'retryable'
            and cancellation_retry_at is not null
          ) or (
            cancellation_failure_disposition = 'manual_review'
            and cancellation_retry_at is null
          )
        ),
        constraint workspace_reservations_cancellation_recovery_reason_check
          check (
            cancellation_recovery_reason is null
            or cancellation_recovery_reason in (
              'hold_expired',
              'attachment_compensation',
              'supersession_recovery',
              'retryable_failure',
              'stale_claim_recovery'
            )
          )
      );
      create function workspace_reservations_stamp_ownerless_cancellation_time()
      returns trigger
      language plpgsql
      as $$
      begin
        if
          new.reservation_state = 'cancelling'
          and new.cancellation_claim_owner is null
          and new.cancellation_claimed_at is null
        then
          new.updated_at = clock_timestamp();
        end if;
        return new;
      end;
      $$;
      create trigger workspace_reservations_stamp_ownerless_cancellation_time
      before insert or update on workspace_reservations
      for each row
      execute function workspace_reservations_stamp_ownerless_cancellation_time();
      insert into workspace_reservations (
        id,
        reservation_state,
        payment_state,
        dotypos_reservation_id,
        cancellation_claim_owner,
        cancellation_claimed_at
      )
      values
        (
          'draft-owned',
          'cancelling',
          'not_started',
          'synthetic-owned-provider',
          'synthetic-owner',
          now()
        ),
        (
          'draft-ownerless',
          'cancelling',
          'not_started',
          'synthetic-ownerless-provider',
          null,
          null
        )
    `);

    await applyCancellationMigration(database);

    const upgraded = await database.query<{
      cancellation_claim_owner: string | null;
      cancellation_failure_disposition: string | null;
      id: string;
      reservation_state: string;
    }>(`
      select
        id,
        reservation_state,
        cancellation_claim_owner,
        cancellation_failure_disposition
      from workspace_reservations
      order by id
    `);
    expect(upgraded.rows).toEqual([
      {
        id: "draft-owned",
        reservation_state: "cancellation_claimed",
        cancellation_claim_owner: "synthetic-owner",
        cancellation_failure_disposition: null,
      },
      {
        id: "draft-ownerless",
        reservation_state: "cancellation_failed",
        cancellation_claim_owner: null,
        cancellation_failure_disposition: "retryable",
      },
    ]);
  });

  test("preserves legacy pending rows and remains compatible with old writers", async () => {
    const database = new PGlite();
    databases.push(database);
    await database.exec(`
      create table workspace_reservations (
        id text primary key,
        reservation_state text not null,
        payment_state text not null,
        dotypos_reservation_id text,
        updated_at timestamptz not null default now()
      );
      insert into workspace_reservations
        (id, reservation_state, payment_state, dotypos_reservation_id, updated_at)
      values
        ('pending-provider-paid', 'cancelling', 'pending', 'synthetic-provider-paid', now() - interval '10 minutes'),
        ('pending-provider-terminal', 'cancelling', 'pending', 'synthetic-provider-terminal', now() - interval '10 minutes'),
        ('legacy-failed', 'cancellation_failed', 'pending', 'synthetic-provider-failed', now() - interval '10 minutes')
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
        reservation_state: "cancellation_failed",
        payment_state: "pending",
        cancellation_claim_owner: null,
        cancellation_failure_disposition: "retryable",
        cancellation_recovery_reason: "retryable_failure",
      },
      {
        id: "pending-provider-terminal",
        reservation_state: "cancellation_failed",
        payment_state: "pending",
        cancellation_claim_owner: null,
        cancellation_failure_disposition: "retryable",
        cancellation_recovery_reason: "retryable_failure",
      },
    ]);

    await expect(
      database.exec(`
        insert into workspace_reservations
          (id, reservation_state, payment_state, dotypos_reservation_id, updated_at)
        values
          (
            'old-writer-ownerless-cancelling',
            'cancelling',
            'not_started',
            'synthetic-provider-old-writer',
            now() - interval '30 minutes'
          )
      `)
    ).resolves.toBeDefined();

    const ownerlessClaims = await database.query<{
      cancellation_failure_disposition: string | null;
      cancellation_recovery_reason: string | null;
      cancellation_retry_at: Date | null;
      id: string;
    }>(`
      select
        id,
        cancellation_failure_disposition,
        cancellation_recovery_reason,
        cancellation_retry_at
      from workspace_reservations
      where id = 'old-writer-ownerless-cancelling'
    `);
    expect(ownerlessClaims.rows).toEqual([
      {
        id: "old-writer-ownerless-cancelling",
        cancellation_failure_disposition: "retryable",
        cancellation_recovery_reason: "retryable_failure",
        cancellation_retry_at: expect.any(Date),
      },
    ]);

    const immediateTakeover = await database.query<{ id: string }>(`
      update workspace_reservations
      set
        reservation_state = 'cancellation_claimed',
        cancellation_claim_owner = 'new-worker',
        cancellation_claimed_at = now(),
        cancellation_failure_disposition = null,
        cancellation_retry_at = null,
        updated_at = now()
      where
        id = 'old-writer-ownerless-cancelling'
        and reservation_state = 'cancellation_failed'
        and cancellation_failure_disposition = 'retryable'
        and cancellation_retry_at <= now()
      returning id
    `);
    expect(immediateTakeover.rows).toEqual([
      { id: "old-writer-ownerless-cancelling" },
    ]);
  });

  test("durably hands a real old-writer cancellation update to the new worker", async () => {
    const database = new PGlite();
    databases.push(database);
    await database.exec(`
      create table workspace_reservations (
        id text primary key,
        reservation_state text not null,
        payment_state text not null,
        dotypos_reservation_id text,
        updated_at timestamptz not null default now()
      );
      insert into workspace_reservations
        (id, reservation_state, payment_state, dotypos_reservation_id, updated_at)
      values
        ('old-writer-update', 'held', 'not_started', 'synthetic-provider', now())
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
      await database.query<{
        cancellation_failure_disposition: string | null;
        cancellation_recovery_reason: string | null;
        cancellation_retry_at: Date | null;
        reservation_state: string;
      }>(`
        select
          reservation_state,
          cancellation_failure_disposition,
          cancellation_recovery_reason,
          cancellation_retry_at
        from workspace_reservations
        where id = 'old-writer-update'
      `)
    ).rows;
    expect(legacyClaim).toMatchObject({
      reservation_state: "cancellation_failed",
      cancellation_failure_disposition: "retryable",
      cancellation_recovery_reason: "retryable_failure",
    });
    expect(legacyClaim?.cancellation_retry_at).not.toBeNull();

    const takeover = await database.query<{ id: string }>(`
      update workspace_reservations
      set
        reservation_state = 'cancellation_claimed',
        cancellation_claim_owner = 'new-worker',
        cancellation_claimed_at = now(),
        cancellation_failure_disposition = null,
        cancellation_retry_at = null,
        updated_at = now()
      where
        id = 'old-writer-update'
        and reservation_state = 'cancellation_failed'
        and cancellation_failure_disposition = 'retryable'
        and cancellation_retry_at <= now()
      returning id
    `);
    expect(takeover.rows).toEqual([{ id: "old-writer-update" }]);
  });

  test("backfills legacy failures without creating invalid half-leases", async () => {
    const database = new PGlite();
    databases.push(database);
    await database.exec(`
      create table workspace_reservations (
        id text primary key,
        reservation_state text not null,
        payment_state text not null,
        dotypos_reservation_id text,
        updated_at timestamptz not null default now()
      );
      insert into workspace_reservations
        (id, reservation_state, payment_state, dotypos_reservation_id)
      values
        ('legacy-failed', 'cancellation_failed', 'not_started', 'synthetic-provider')
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
    await expect(
      database.exec(`
        update workspace_reservations
        set
          reservation_state = 'cancellation_claimed',
          cancellation_claim_owner = null,
          cancellation_claimed_at = null
        where id = 'legacy-failed'
      `)
    ).rejects.toBeDefined();
    await expect(
      database.exec(`
        update workspace_reservations
        set
          reservation_state = 'cancellation_failed',
          cancellation_claim_owner = 'synthetic-owner',
          cancellation_claimed_at = now()
        where id = 'legacy-failed'
      `)
    ).rejects.toBeDefined();

    await expect(applyCancellationMigration(database)).resolves.toBeUndefined();
  });
});
