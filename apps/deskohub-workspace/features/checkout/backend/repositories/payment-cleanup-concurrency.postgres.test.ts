import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { randomUUID } from "node:crypto";
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
import { applyCommittedWorkspaceMigrations } from "@/shared/testing/workspace-migrations";
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
  PaymentAttemptStateError,
} from "./payment-attempt.repository";

const realPostgresUrl = process.env.WORKSPACE_REAL_POSTGRES_TEST_URL;
let testDatabaseName: string | undefined;
let testDatabaseUrl: string | undefined;

const requireRealPostgresUrl = () => {
  if (!realPostgresUrl) {
    throw new Error(
      "WORKSPACE_REAL_POSTGRES_TEST_URL is required for real PostgreSQL concurrency tests."
    );
  }
  return realPostgresUrl;
};

const requireTestDatabaseUrl = () => {
  if (!testDatabaseUrl) {
    throw new Error(
      "Real PostgreSQL concurrency database was not initialized."
    );
  }
  return testDatabaseUrl;
};

const clients: Client[] = [];

const closeTestConnections = async () => {
  const testClients = clients.splice(0);
  await Promise.all(testClients.map((client) => client.end()));
};

const connectClient = async (applicationName: string) => {
  const client = new Client({
    connectionString: requireTestDatabaseUrl(),
    application_name: applicationName,
  });
  clients.push(client);
  await client.connect();
  return client;
};

const repositoryLayer = (pool: Pool) => {
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

const runRepositories = async <A, E>(
  applicationName: string,
  effect: Effect.Effect<
    A,
    E,
    PaymentAttemptRepository | WorkspaceReservationRepository
  >
) => {
  const pool = new Pool({
    connectionString: requireTestDatabaseUrl(),
    application_name: applicationName,
    max: 1,
    types: drizzleRawTypeParsers,
  });

  try {
    return await Effect.runPromise(
      Effect.scoped(effect.pipe(Effect.provide(repositoryLayer(pool))))
    );
  } finally {
    await pool.end();
  }
};

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
        amount: {
          value: 1000,
          exponent: 2,
          currency: "CZK",
        },
      });
    }).pipe(Effect.result)
  );

beforeAll(async () => {
  const admin = new Client({ connectionString: requireRealPostgresUrl() });
  testDatabaseName = `payment_cleanup_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = new URL(requireRealPostgresUrl());
  databaseUrl.pathname = `/${testDatabaseName}`;
  testDatabaseUrl = databaseUrl.toString();

  try {
    await admin.connect();
    await admin.query(`create database "${testDatabaseName}"`);
    const migrationClient = new Client({ connectionString: testDatabaseUrl });
    try {
      await migrationClient.connect();
      await applyCommittedWorkspaceMigrations(migrationClient);
      const uuid = await migrationClient.query<{ generated: boolean }>(
        "select uuid_generate_v7() is not null as generated"
      );
      expect(uuid.rows[0]?.generated).toBe(true);
    } finally {
      await migrationClient.end();
    }
  } finally {
    await admin.end();
  }
});

beforeEach(async () => {
  await closeTestConnections();
  const admin = new Client({ connectionString: requireTestDatabaseUrl() });
  try {
    await admin.connect();
    await admin.query(`
      drop trigger if exists block_payment_winner on workspace_reservations;
      drop function if exists block_payment_winner();
      truncate table workspace_reservations cascade
    `);
  } finally {
    await admin.end();
  }
});

afterEach(closeTestConnections);

afterAll(async () => {
  await closeTestConnections();
  if (!testDatabaseName) return;
  const admin = new Client({ connectionString: requireRealPostgresUrl() });
  try {
    await admin.connect();
    await admin.query(
      `drop database if exists "${testDatabaseName}" with (force)`
    );
  } finally {
    await admin.end();
  }
});

describe("payment and cleanup independent PostgreSQL sessions", () => {
  test("payment wins the first row lock and cleanup rechecks the committed tuple", async () => {
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
      "clock_timestamp() + interval '5 minutes'"
    );
    await observer.query(`
      create function block_payment_winner() returns trigger
      language plpgsql
      as $$
      begin
        if
          new.id = 'payment-wins'
          and new.payment_state = 'pending'
        then
          perform pg_advisory_xact_lock(5543201);
        end if;
        return new;
      end;
      $$;
      create trigger block_payment_winner
      after update on workspace_reservations
      for each row execute function block_payment_winner()
    `);
    await blocker.query("begin");
    const blockerPid = Number(
      (await blocker.query<{ pid: number }>("select pg_backend_pid() as pid"))
        .rows[0]?.pid
    );
    await blocker.query("select pg_advisory_xact_lock(5543201)");

    const payment = createPayment("payment-wins");
    await waitForRowLock(observer, "payment-payment-wins", blockerPid);
    const paymentPid = Number(
      (
        await observer.query<{ pid: number }>(
          `
            select pid
            from pg_stat_activity
            where application_name = $1
          `,
          ["payment-payment-wins"]
        )
      ).rows[0]?.pid
    );
    expect(paymentPid).toBeGreaterThan(0);
    const cleanup = runRepositories(
      "cleanup-payment-wins",
      Effect.gen(function* () {
        const reservations = yield* WorkspaceReservationRepository;
        return yield* reservations.claimSupersessionCancellation({
          id: "payment-wins",
          ownerId: "cleanup-owner",
        });
      })
    );
    await waitForRowLock(observer, "cleanup-payment-wins", paymentPid);
    await blocker.query("commit");
    expect((await payment)._tag).toBe("Success");
    expect(await cleanup).toBeNull();
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
    const blocker = await connectClient("expired-cleanup-wins-blocker");
    const observer = await connectClient("expired-cleanup-wins-observer");
    await seedReservation(
      observer,
      "expired-cleanup-wins",
      "clock_timestamp() - interval '1 microsecond'"
    );
    await blocker.query("begin");
    const blockerPid = Number(
      (await blocker.query<{ pid: number }>("select pg_backend_pid() as pid"))
        .rows[0]?.pid
    );
    await blocker.query(
      "select id from workspace_reservations where id = $1 for update",
      ["expired-cleanup-wins"]
    );
    const beforeClaim = (
      await observer.query<{ now: Date }>("select clock_timestamp() as now")
    ).rows[0]?.now;
    const cleanup = runRepositories(
      "cleanup-expired-cleanup-wins",
      Effect.gen(function* () {
        const reservations = yield* WorkspaceReservationRepository;
        return yield* reservations.claimCancellation({
          id: "expired-cleanup-wins",
          ownerId: "cleanup-owner",
          recoveryReason: "hold_expired",
          holdExpiredAt: Temporal.Instant.from("2099-01-01T00:00:00Z"),
        });
      })
    );
    await waitForRowLock(observer, "cleanup-expired-cleanup-wins", blockerPid);
    const payment = createPayment("expired-cleanup-wins");
    await waitForRowLock(observer, "payment-expired-cleanup-wins", blockerPid);
    await blocker.query("commit");

    expect(await cleanup).toMatchObject({
      reservationState: "cancellation_claimed",
      cancellationClaimOwner: "cleanup-owner",
    });
    expect((await payment)._tag).toBe("Failure");
    const stored = await observer.query<{
      attempt_count: number;
      payment_state: string;
      reservation_hold_expired_at: Date | null;
      reservation_state: string;
    }>(`
      select
        count(payment_attempts.id)::integer as attempt_count,
        workspace_reservations.payment_state,
        workspace_reservations.reservation_hold_expired_at,
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
      reservation_hold_expired_at: stored.rows[0]?.reservation_hold_expired_at,
      reservation_state: "cancellation_claimed",
    });
    const expiredEvidence = stored.rows[0]?.reservation_hold_expired_at;
    expect(expiredEvidence).not.toBeNull();
    expect(expiredEvidence?.getTime()).toBeGreaterThanOrEqual(
      beforeClaim?.getTime() ?? Number.POSITIVE_INFINITY
    );
    expect(expiredEvidence?.toISOString()).not.toBe("2099-01-01T00:00:00.000Z");
  });

  test("process-clock-ahead cleanup loses while the database deadline is future", async () => {
    const observer = await connectClient("future-deadline-observer");
    await seedReservation(
      observer,
      "future-deadline",
      "clock_timestamp() + interval '5 minutes'"
    );

    const [cleanup, payment] = await Promise.all([
      runRepositories(
        "cleanup-future-deadline",
        Effect.gen(function* () {
          const reservations = yield* WorkspaceReservationRepository;
          return yield* reservations.claimCancellation({
            id: "future-deadline",
            ownerId: "ahead-cleanup-owner",
            recoveryReason: "hold_expired",
            holdExpiredAt: Temporal.Instant.from("2099-01-01T00:00:00Z"),
          });
        })
      ),
      createPayment("future-deadline"),
    ]);

    expect(cleanup).toBeNull();
    expect(payment._tag).toBe("Success");
  });
});
