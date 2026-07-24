import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import * as PgClient from "@effect/sql-pg/PgClient";
import { EffectCache } from "drizzle-orm/cache/core/cache-effect";
import { EffectLogger, make } from "drizzle-orm/effect-postgres";
import { Effect, Layer } from "effect";
import { Client, Pool } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import { drizzleRawTypeParsers } from "@/db/postgres-type-parsers";
import { relations } from "@/db/relations";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
  PaymentAttemptStateError,
} from "./payment-attempt.repository";

const postgresConfig = {
  database: "workspace_concurrency",
  host: "127.0.0.1",
  port: 55_432,
  user: "postgres",
} as const;

const pools: Pool[] = [];
const clients: Client[] = [];

const connectClient = async (applicationName: string) => {
  const client = new Client({
    ...postgresConfig,
    application_name: applicationName,
  });
  clients.push(client);
  await client.connect();
  return client;
};

const repositoryLayer = (applicationName: string) => {
  const pool = new Pool({
    ...postgresConfig,
    application_name: applicationName,
    max: 1,
    types: drizzleRawTypeParsers,
  });
  pools.push(pool);
  const PgClientLive = PgClient.layerFrom(
    PgClient.fromPool({ acquire: Effect.succeed(pool) })
  ).pipe(Layer.orDie);
  const DatabaseLive = Layer.effect(
    WorkspaceDatabase,
    make({ relations }).pipe(
      Effect.provide(Layer.merge(EffectCache.Default, EffectLogger.layer)),
      Effect.map((db) => WorkspaceDatabase.of({ db }))
    )
  ).pipe(Layer.provide(PgClientLive));
  return Layer.mergeAll(
    DatabaseLive,
    PaymentAttemptRepositoryLive.pipe(Layer.provide(DatabaseLive)),
    WorkspaceReservationRepositoryLive.pipe(Layer.provide(DatabaseLive))
  );
};

const runRepositories = <A, E>(
  applicationName: string,
  effect: Effect.Effect<
    A,
    E,
    PaymentAttemptRepository | WorkspaceReservationRepository
  >
) =>
  Effect.runPromise(
    Effect.scoped(effect.pipe(Effect.provide(repositoryLayer(applicationName))))
  );

const waitForRowLock = async (
  observer: Client,
  applicationName: string,
  blockerPid: number
) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await observer.query<{ blocked: boolean }>(
      `
        select exists (
          select 1
          from pg_stat_activity
          where
            application_name = $1
            and wait_event_type = 'Lock'
            and $2 = any(pg_blocking_pids(pid))
        ) as blocked
      `,
      [applicationName, blockerPid]
    );
    if (result.rows[0]?.blocked) return;
    await Bun.sleep(10);
  }
  throw new Error(
    `Synthetic PostgreSQL session ${applicationName} did not reach its expected row lock.`
  );
};

const seedReservation = async (
  client: Client,
  id: string,
  deadlineSql: string
) => {
  await client.query(
    `
      insert into workspace_reservations (
        id,
        checkout_session_key,
        checkout_attempt_key,
        correlation_id,
        dotypos_customer_id,
        dotypos_reservation_id,
        customer_access_code,
        reservation_state,
        payment_state,
        fulfillment_state,
        reservation_details,
        locale,
        reservation_hold_expires_at
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        '',
        'held',
        'not_started',
        'not_started',
        '{"kind":"cowork","entryTier":"basic","coffee":false}'::jsonb,
        'en-US',
        ${deadlineSql}
      )
    `,
    [
      id,
      `session-${id}`,
      `attempt-${id}`,
      `correlation-${id}`,
      `customer-${id}`,
      `provider-${id}`,
    ]
  );
};

const createPayment = (reservationId: string) =>
  runRepositories(
    `payment-${reservationId}`,
    Effect.gen(function* () {
      const payments = yield* PaymentAttemptRepository;
      return yield* payments.create({
        workspaceReservationId: reservationId,
        providerOrderId: `provider-order-${reservationId}`,
        amountValue: 1000,
        amountExponent: 2,
        currency: "CZK",
      });
    }).pipe(Effect.result)
  );

beforeEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
  await Promise.all(clients.splice(0).map((client) => client.end()));
  const admin = await connectClient("concurrency-setup");
  await admin.query(`
    drop table if exists payment_attempts;
    drop table if exists workspace_reservations;
    drop function if exists uuid_generate_v7();
    create function uuid_generate_v7() returns uuid language sql volatile as $$
      select gen_random_uuid()
    $$;
    create table workspace_reservations (
      id text primary key,
      checkout_session_key text not null,
      checkout_attempt_key text not null unique,
      correlation_id text not null unique,
      dotypos_customer_id text not null,
      dotypos_reservation_id text,
      customer_access_code text not null,
      reservation_state text not null,
      payment_state text not null,
      fulfillment_state text not null,
      active_payment_attempt_id text,
      reservation_details jsonb not null,
      locale text not null,
      reservation_hold_expires_at timestamptz,
      reservation_hold_expired_at timestamptz,
      reservation_created_at timestamptz,
      reservation_confirmed_at timestamptz,
      reservation_cancelled_at timestamptz,
      cancellation_claim_owner text,
      cancellation_claimed_at timestamptz,
      cancellation_failure_disposition text,
      cancellation_retry_at timestamptz,
      cancellation_recovery_reason text,
      paid_at timestamptz,
      fulfilled_at timestamptz,
      fulfillment_failed_at timestamptz,
      failure_code text,
      fulfillment_failure_code text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table payment_attempts (
      id text primary key,
      workspace_reservation_id text not null references workspace_reservations(id),
      provider text not null,
      provider_order_id text not null unique,
      security_token text,
      state text not null,
      amount_value integer not null,
      amount_exponent integer not null,
      currency text not null,
      provider_redirect_url text,
      last_webhook_event_id text,
      last_provider_operation_id text,
      last_provider_status text,
      failure_code text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
});

afterAll(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
  await Promise.all(clients.splice(0).map((client) => client.end()));
});

describe("payment and cleanup independent PostgreSQL sessions", () => {
  test("payment wins its row lock before later due cleanup under READ COMMITTED", async () => {
    const blocker = await connectClient("payment-wins-blocker");
    const observer = await connectClient("payment-wins-observer");
    const isolation = await observer.query<{
      default_transaction_isolation: string;
    }>("show default_transaction_isolation");
    expect(isolation.rows[0]?.default_transaction_isolation).toBe(
      "read committed"
    );
    await seedReservation(
      observer,
      "payment-wins",
      "clock_timestamp() + interval '2 seconds'"
    );
    await blocker.query("begin");
    const blockerPid = Number(
      (await blocker.query<{ pid: number }>("select pg_backend_pid() as pid"))
        .rows[0]?.pid
    );
    await blocker.query(
      "select id from workspace_reservations where id = $1 for update",
      ["payment-wins"]
    );

    const payment = createPayment("payment-wins");
    await waitForRowLock(observer, "payment-payment-wins", blockerPid);
    await blocker.query("commit");
    expect((await payment)._tag).toBe("Success");
    await observer.query(
      "select pg_sleep(greatest(0, extract(epoch from reservation_hold_expires_at - clock_timestamp()))) from workspace_reservations where id = $1",
      ["payment-wins"]
    );
    const [databaseNow] = (
      await observer.query<{ now: Date }>("select clock_timestamp() as now")
    ).rows;
    const cleanup = await runRepositories(
      "cleanup-payment-wins",
      Effect.gen(function* () {
        const reservations = yield* WorkspaceReservationRepository;
        return yield* reservations.claimCancellation({
          id: "payment-wins",
          ownerId: "cleanup-owner",
          recoveryReason: "hold_expired",
          holdExpiredAt: Temporal.Instant.from(
            databaseNow?.now.toISOString() ?? ""
          ),
        });
      })
    );
    expect(cleanup).toBeNull();
    const stored = await observer.query<{
      attempt_count: number;
      cancellation_claim_owner: string | null;
      payment_state: string;
    }>(`
      select
        count(payment_attempts.id)::integer as attempt_count,
        workspace_reservations.cancellation_claim_owner,
        workspace_reservations.payment_state
      from workspace_reservations
      left join payment_attempts
        on payment_attempts.workspace_reservation_id = workspace_reservations.id
      where workspace_reservations.id = 'payment-wins'
      group by workspace_reservations.id
    `);
    expect(stored.rows[0]).toEqual({
      attempt_count: 1,
      cancellation_claim_owner: null,
      payment_state: "pending",
    });
  });

  test("cleanup ownership wins the first row lock and payment rechecks the new tuple", async () => {
    const blocker = await connectClient("cleanup-wins-blocker");
    const observer = await connectClient("cleanup-wins-observer");
    await seedReservation(
      observer,
      "cleanup-wins",
      "clock_timestamp() + interval '5 minutes'"
    );
    await blocker.query("begin");
    const blockerPid = Number(
      (await blocker.query<{ pid: number }>("select pg_backend_pid() as pid"))
        .rows[0]?.pid
    );
    await blocker.query(
      "select id from workspace_reservations where id = $1 for update",
      ["cleanup-wins"]
    );

    const cleanup = runRepositories(
      "cleanup-cleanup-wins",
      Effect.gen(function* () {
        const reservations = yield* WorkspaceReservationRepository;
        return yield* reservations.claimSupersessionCancellation({
          id: "cleanup-wins",
          ownerId: "cleanup-owner",
        });
      })
    );
    await waitForRowLock(observer, "cleanup-cleanup-wins", blockerPid);
    const payment = createPayment("cleanup-wins");
    await waitForRowLock(observer, "payment-cleanup-wins", blockerPid);
    await blocker.query("commit");

    expect(await cleanup).toMatchObject({
      reservationState: "cancellation_claimed",
      cancellationClaimOwner: "cleanup-owner",
    });
    const paymentResult = await payment;
    expect(paymentResult._tag).toBe("Failure");
    if (paymentResult._tag === "Failure") {
      expect(paymentResult.failure).toBeInstanceOf(PaymentAttemptStateError);
    }
    const stored = await observer.query<{
      attempt_count: number;
      cancellation_claim_owner: string | null;
      reservation_state: string;
    }>(`
      select
        count(payment_attempts.id)::integer as attempt_count,
        workspace_reservations.cancellation_claim_owner,
        workspace_reservations.reservation_state
      from workspace_reservations
      left join payment_attempts
        on payment_attempts.workspace_reservation_id = workspace_reservations.id
      where workspace_reservations.id = 'cleanup-wins'
      group by workspace_reservations.id
    `);
    expect(stored.rows[0]).toEqual({
      attempt_count: 0,
      cancellation_claim_owner: "cleanup-owner",
      reservation_state: "cancellation_claimed",
    });
  });

  test("already-expired cleanup wins while payment is rejected by database time", async () => {
    const observer = await connectClient("expired-cleanup-wins-observer");
    await seedReservation(
      observer,
      "expired-cleanup-wins",
      "clock_timestamp() - interval '1 microsecond'"
    );
    const [databaseNow] = (
      await observer.query<{ now: Date }>("select clock_timestamp() as now")
    ).rows;
    const [cleanup, payment] = await Promise.all([
      runRepositories(
        "cleanup-expired-cleanup-wins",
        Effect.gen(function* () {
          const reservations = yield* WorkspaceReservationRepository;
          return yield* reservations.claimCancellation({
            id: "expired-cleanup-wins",
            ownerId: "cleanup-owner",
            recoveryReason: "hold_expired",
            holdExpiredAt: Temporal.Instant.from(
              databaseNow?.now.toISOString() ?? ""
            ).add({ seconds: 1 }),
          });
        })
      ),
      createPayment("expired-cleanup-wins"),
    ]);
    expect(cleanup).toMatchObject({
      reservationState: "cancellation_claimed",
      cancellationClaimOwner: "cleanup-owner",
    });
    expect(payment._tag).toBe("Failure");
    const stored = await observer.query<{
      attempt_count: number;
      payment_state: string;
      reservation_state: string;
    }>(`
      select
        count(payment_attempts.id)::integer as attempt_count,
        workspace_reservations.payment_state,
        workspace_reservations.reservation_state
      from workspace_reservations
      left join payment_attempts
        on payment_attempts.workspace_reservation_id = workspace_reservations.id
      where workspace_reservations.id = 'expired-cleanup-wins'
      group by workspace_reservations.id
    `);
    expect(stored.rows[0]).toEqual({
      attempt_count: 0,
      payment_state: "not_started",
      reservation_state: "cancellation_claimed",
    });
  });
});
