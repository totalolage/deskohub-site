import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const realPostgresUrl = process.env.WORKSPACE_REAL_POSTGRES_TEST_URL;
const realPostgresTest = realPostgresUrl ? test : test.skip;

describe("payment reconciliation real PostgreSQL locking", () => {
  realPostgresTest(
    "fences replacement admission and cleanup while provider lookup owns the reservation",
    async () => {
      if (!realPostgresUrl) return;

      const schema = `payment_reconciliation_${randomUUID().replaceAll("-", "")}`;
      const owner = new Client({ connectionString: realPostgresUrl });
      const contender = new Client({ connectionString: realPostgresUrl });
      await Promise.all([owner.connect(), contender.connect()]);

      try {
        await owner.query(`create schema "${schema}"`);
        for (const client of [owner, contender]) {
          await client.query(`set search_path to "${schema}"`);
        }
        await owner.query(`
          create table payment_attempts (
            id text primary key,
            workspace_reservation_id text not null,
            admission_version integer not null,
            state text not null,
            provider_order_id text not null unique,
            provider_evidence_conflicted boolean not null default false
          );
          create table payment_evidence_conflicts (
            payment_attempt_id text not null
          );
          create table workspace_reservations (
            id text primary key,
            reservation_state text not null,
            payment_state text not null,
            active_payment_attempt_id text,
            active_payment_evidence_conflicted boolean not null default false,
            payment_reconciliation_attempt_id text,
            payment_reconciliation_claim_id text,
            payment_reconciliation_claim_expires_at timestamptz
          );
        `);

        const migration = await Bun.file(
          new URL(
            "../../../../db/migrations/20260725004304_payment_admission_settlement/migration.sql",
            import.meta.url
          )
        ).text();
        const functionStart = migration.indexOf(
          'CREATE FUNCTION "guard_unverified_v2_reservation_terminal"'
        );
        const nextFunction = migration.indexOf(
          'CREATE FUNCTION "reject_provider_evidence_conflicted_reservation_settlement"',
          functionStart
        );
        if (functionStart < 0 || nextFunction < 0) {
          throw new Error("The reconciliation reservation guard is missing.");
        }
        for (const statement of migration
          .slice(functionStart, nextFunction)
          .split("--> statement-breakpoint")
          .map((value) => value.trim())
          .filter(Boolean)) {
          await owner.query(statement);
        }

        await owner.query(`
          insert into payment_attempts (
            id, workspace_reservation_id, admission_version, state,
            provider_order_id
          ) values ('attempt-a', 'reservation-a', 2, 'created', 'order-a');
          insert into workspace_reservations (
            id, reservation_state, payment_state, active_payment_attempt_id,
            payment_reconciliation_attempt_id,
            payment_reconciliation_claim_id,
            payment_reconciliation_claim_expires_at
          ) values (
            'reservation-a', 'held', 'pending', 'attempt-a',
            'attempt-a', 'claim-a', clock_timestamp() + interval '2 minutes'
          );
        `);

        let releaseLookup!: () => void;
        const lookupBarrier = new Promise<void>((resolve) => {
          releaseLookup = resolve;
        });
        const simulatedProviderLookup = lookupBarrier.then(() => "complete");

        await contender.query("begin");
        await contender.query(`
          insert into payment_attempts (
            id, workspace_reservation_id, admission_version, state,
            provider_order_id
          ) values ('attempt-b', 'reservation-a', 2, 'created', 'order-b')
        `);
        await expect(
          contender.query(`
            update workspace_reservations
            set active_payment_attempt_id = 'attempt-b'
            where id = 'reservation-a'
          `)
        ).rejects.toThrow();
        await contender.query("rollback");

        releaseLookup();
        await simulatedProviderLookup;

        const attempts = await owner.query<{ count: string }>(
          "select count(*) from payment_attempts where workspace_reservation_id = 'reservation-a'"
        );
        expect(attempts.rows[0]?.count).toBe("1");
        await expect(
          contender.query(`
            update workspace_reservations
            set reservation_state = 'cancelling'
            where id = 'reservation-a'
          `)
        ).rejects.toThrow();
      } finally {
        await owner.query(`drop schema if exists "${schema}" cascade`);
        await Promise.all([owner.end(), contender.end()]);
      }
    },
    30_000
  );
});
