import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

const databases: PGlite[] = [];
const cancellationMigrationUrl = new URL(
  "./20260724172713_reservation_cancellation_ownership_fail_closed/migration.sql",
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
        reservation_hold_expires_at timestamptz,
        reservation_hold_expired_at timestamptz,
        reservation_confirmed_at timestamptz,
        failure_code text,
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
        (
          id,
          reservation_state,
          payment_state,
          dotypos_reservation_id,
          reservation_hold_expires_at
        )
      values
        (
          'rollout-reservation',
          'held',
          'not_started',
          'synthetic-provider',
          now() - interval '1 minute'
        )
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
        cancellation_recovery_reason = 'hold_expired',
        reservation_hold_expired_at = now(),
        failure_code = null,
        updated_at = now()
      where
        id = 'rollout-reservation'
        and reservation_hold_expires_at <= now()
        and (
          reservation_state in ('held', 'hold_expired')
          or (
            reservation_state = 'cancellation_failed'
            and cancellation_failure_disposition = 'retryable'
            and cancellation_retry_at <= now()
          )
          or (
            reservation_state in ('cancelling', 'cancellation_claimed')
            and (
              (
                cancellation_claim_owner is null
                and cancellation_claimed_at is null
                and updated_at <= now() - interval '5 minutes'
              )
              or (
                cancellation_claim_owner is not null
                and cancellation_claimed_at is not null
                and cancellation_claimed_at <= now() - interval '5 minutes'
              )
            )
          )
        )
        and payment_state in ('not_started', 'failed', 'cancelled', 'expired')
        and reservation_confirmed_at is null
        and (
          failure_code is null
          or (
            failure_code not like 'hold_creation_candidate:%'
            and failure_code not like 'hold_creation_candidate_compensating:%'
            and failure_code not like 'hold_creation_orphan_recovery:%'
            and failure_code not like 'hold_creation_orphan_processing:%'
            and failure_code not like 'hold_creation_orphan_awaiting_visibility:%'
            and failure_code not like 'hold_creation_orphan_verifying:%'
          )
        )
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
        cancellation_recovery_reason = 'hold_expired',
        reservation_hold_expired_at = now(),
        failure_code = null,
        updated_at = now()
      where
        id = 'rollout-reservation'
        and reservation_hold_expires_at <= now()
        and (
          reservation_state in ('held', 'hold_expired')
          or (
            reservation_state = 'cancellation_failed'
            and cancellation_failure_disposition = 'retryable'
            and cancellation_retry_at <= now()
          )
          or (
            reservation_state = 'cancelling'
            and (
              (
                cancellation_claim_owner is null
                and cancellation_claimed_at is null
                and updated_at <= now() - interval '5 minutes'
              )
              or (
                cancellation_claim_owner is not null
                and cancellation_claimed_at is not null
                and cancellation_claimed_at <= now() - interval '5 minutes'
              )
            )
          )
        )
        and payment_state in ('not_started', 'failed', 'cancelled', 'expired')
        and reservation_confirmed_at is null
        and (
          failure_code is null
          or (
            failure_code not like 'hold_creation_candidate:%'
            and failure_code not like 'hold_creation_candidate_compensating:%'
            and failure_code not like 'hold_creation_orphan_recovery:%'
            and failure_code not like 'hold_creation_orphan_processing:%'
            and failure_code not like 'hold_creation_orphan_awaiting_visibility:%'
            and failure_code not like 'hold_creation_orphan_verifying:%'
          )
        )
      returning id, reservation_state
    `);

  const legacyOwnerlessSupersessionClaim = (
    database: PGlite,
    id = "rollout-reservation"
  ) =>
    database.query<{
      dotypos_reservation_id: string;
      id: string;
      reservation_state: string;
    }>(`
      update workspace_reservations
      set
        reservation_state = 'cancelling',
        updated_at = now()
      where
        id = '${id}'
        and reservation_state = 'held'
        and payment_state in ('not_started', 'failed', 'cancelled', 'expired')
      returning id, reservation_state, dotypos_reservation_id
    `);

  const runLegacyOwnerlessSupersessionCaller = async (
    database: PGlite,
    id = "rollout-reservation"
  ) => {
    let providerCancellationCount = 0;
    let providerStatusCount = 0;

    try {
      const [claimed] = (await legacyOwnerlessSupersessionClaim(database, id))
        .rows;
      if (claimed) {
        providerStatusCount += 1;
        const providerStatus = "NEW";
        if (providerStatus === "NEW") {
          providerCancellationCount += 1;
        }
      }
      return {
        claimError: undefined,
        claimed,
        providerCancellationCount,
        providerStatusCount,
      };
    } catch (claimError) {
      return {
        claimError,
        claimed: undefined,
        providerCancellationCount,
        providerStatusCount,
      };
    }
  };

  test("keeps the exact ownerless legacy supersession caller outside the provider boundary", async () => {
    const database = await prepareRolloutDatabase();
    const {
      claimError,
      claimed,
      providerCancellationCount,
      providerStatusCount,
    } = await runLegacyOwnerlessSupersessionCaller(database);

    expect(claimError).toMatchObject({ code: "55000" });
    expect(providerCancellationCount).toBe(0);
    expect(providerStatusCount).toBe(0);
    expect(claimed).toBeUndefined();
    expect((await newWorkerClaim(database)).rows).toHaveLength(1);
  });

  test("returns no provider permission to the exact legacy caller when the new worker claims first", async () => {
    const database = await prepareRolloutDatabase();

    expect((await newWorkerClaim(database)).rows).toHaveLength(1);
    const result = await runLegacyOwnerlessSupersessionCaller(database);
    expect(result).toMatchObject({
      claimError: undefined,
      claimed: undefined,
      providerCancellationCount: 0,
      providerStatusCount: 0,
    });
  });

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
      create function workspace_reservations_handoff_ownerless_cancellation()
      returns trigger
      language plpgsql
      as $$
      begin
        if
          new.reservation_state = 'cancelling'
          and new.cancellation_claim_owner is null
          and new.cancellation_claimed_at is null
        then
          new.reservation_state = 'cancellation_failed';
          new.cancellation_failure_disposition = 'retryable';
          new.cancellation_retry_at = clock_timestamp();
          new.cancellation_recovery_reason = 'retryable_failure';
          new.updated_at = clock_timestamp();
        end if;
        return new;
      end;
      $$;
      create trigger workspace_reservations_handoff_ownerless_cancellation
      before insert or update on workspace_reservations
      for each row
      execute function workspace_reservations_handoff_ownerless_cancellation();
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
        ),
        (
          'published-held',
          'held',
          'not_started',
          'synthetic-published-provider',
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
      {
        id: "published-held",
        reservation_state: "held",
        cancellation_claim_owner: null,
        cancellation_failure_disposition: null,
      },
    ]);

    const legacyResult = await runLegacyOwnerlessSupersessionCaller(
      database,
      "published-held"
    );
    expect(legacyResult.claimError).toMatchObject({ code: "55000" });
    expect(legacyResult.providerStatusCount).toBe(0);
    expect(legacyResult.providerCancellationCount).toBe(0);
  });

  test("preserves legacy pending rows and rejects new ownerless old-writer claims", async () => {
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
    ).rejects.toMatchObject({ code: "55000" });

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
    expect(ownerlessClaims.rows).toEqual([]);
  });

  test("rejects a real old-writer cancellation update before the new worker claims", async () => {
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

    await expect(
      database.exec(`
        update workspace_reservations
        set
          reservation_state = 'cancelling',
          updated_at = now() - interval '30 minutes'
        where
          id = 'old-writer-update'
          and reservation_state in ('held', 'hold_expired', 'cancellation_failed')
          and payment_state <> 'paid'
      `)
    ).rejects.toMatchObject({ code: "55000" });

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
      reservation_state: "held",
      cancellation_failure_disposition: null,
      cancellation_recovery_reason: null,
    });
    expect(legacyClaim?.cancellation_retry_at).toBeNull();

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
        and reservation_state = 'held'
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
