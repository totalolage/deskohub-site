import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { EMAIL_TEST_DOMAIN, testEmailAddress } from "@deskohub/test-email";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import type { Pool } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import { makeDatabaseClient, makeDatabasePool } from "@/db/database-client";
import { CampaignCandidateRepository } from "@/features/email-campaigns/backend/campaign-candidate.repository";
import { CustomerEventReconciler } from "@/shared/backend/customer-events/customer-event-reconciler";
import { createScratchPostgresDatabase } from "@/shared/testing/postgres-scratch-database.test-utils";
import {
  holdPostgresTransaction,
  waitForPostgresLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import {
  linkMigrationsBefore,
  workspaceMigrationsFolder,
} from "../migration-scratch-database.test-utils";

const MIGRATION_DIR = "20261020192606_automation_preview_status_approximation";

const testDatabaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;

const migrationStatements = async () =>
  (
    await readFile(
      join(workspaceMigrationsFolder, MIGRATION_DIR, "migration.sql"),
      "utf8"
    )
  ).split("--> statement-breakpoint");

/** Runs the migration's SQL again and returns each statement's row count. */
const rerunMigration = async (pool: Pool) => {
  const counts: (number | null)[] = [];
  for (const statement of await migrationStatements()) {
    counts.push((await pool.query(statement)).rowCount);
  }
  return counts;
};

type MigratedDatabase = {
  readonly pool: Pool;
  readonly layer: Layer.Layer<WorkspaceDatabase>;
};

/**
 * Brings a scratch database to the state production is in before the
 * migration, seeds it, and applies the remaining migrations. The write
 * `alongside` stays uncommitted until the migration waits on it, as a write
 * of the deployment still serving would.
 */
const migrateAcross = async ({
  seed,
  alongside,
  check,
}: {
  readonly seed: (pool: Pool) => Promise<void>;
  readonly alongside?: { readonly sql: string; readonly values: unknown[] };
  readonly check: (database: MigratedDatabase) => Promise<void>;
}) => {
  const earlierMigrations = await linkMigrationsBefore(MIGRATION_DIR);
  const scratch = await createScratchPostgresDatabase(
    testDatabaseUrl!,
    "account_creation_repair"
  );
  const pool = makeDatabasePool({ connectionString: scratch.url, max: 4 });
  const migrateRemaining = () =>
    migrate(drizzle({ client: pool }), {
      migrationsFolder: workspaceMigrationsFolder,
    });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: earlierMigrations,
    });
    await seed(pool);
    if (alongside) {
      const write = await holdPostgresTransaction(
        pool,
        alongside.sql,
        alongside.values
      );
      const migrated = migrateRemaining();
      // Awaited below; never left unhandled while the write is held.
      migrated.catch(() => undefined);
      try {
        await waitForPostgresLockWaiter(pool, {
          condition: "$1::int = any(pg_blocking_pids(pid))",
          values: [write.pid],
          description: "the migration waiting on the uncommitted write",
        });
      } finally {
        await write.commit();
      }
      await migrated;
    } else {
      await migrateRemaining();
    }
    const db = await Effect.runPromise(makeDatabaseClient(pool));
    await check({
      pool,
      layer: Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.of({ db })),
    });
  } finally {
    await pool.end();
    await scratch.drop();
    await rm(earlierMigrations, { recursive: true, force: true });
  }
};

const instantParameter = (instant: Temporal.Instant) => instant.toString();

const insertAccount = (
  pool: Pool,
  id: string,
  fields: {
    readonly createdAt: Temporal.Instant;
    readonly customerId?: string;
    readonly deletedAt?: Temporal.Instant;
  }
) =>
  pool.query(
    `insert into customer_accounts (id, created_at, dotypos_customer_id, deleted_at)
     values ($1, $2, $3, $4)`,
    [
      id,
      instantParameter(fields.createdAt),
      fields.customerId ?? null,
      fields.deletedAt ? instantParameter(fields.deletedAt) : null,
    ]
  );

const insertLogin = (
  pool: Pool,
  id: string,
  createdAt: Temporal.Instant,
  verified = true
) =>
  pool.query(
    `insert into auth."user" (id, name, email, email_verified, created_at)
     values ($1, '', $2, $3, $4)`,
    [
      id,
      testEmailAddress(`repair-${id}`),
      verified,
      instantParameter(createdAt),
    ]
  );

const insertAccountCreatedEvent = (
  pool: Pool,
  accountId: string,
  customerId: string,
  occurredAt: Temporal.Instant,
  recordedAt = occurredAt
) =>
  pool.query(
    `insert into customer_events
       (kind, occurred_at, recorded_at, dotypos_customer_id, customer_account_id)
     values ('account-created', $1, $2, $3, $4)`,
    [
      instantParameter(occurredAt),
      instantParameter(recordedAt),
      customerId,
      accountId,
    ]
  );

const epochMillisecondsOf = (column: string) =>
  `(extract(epoch from ${column}) * 1000)::float8`;

const accountCreatedAt = async (pool: Pool, id: string) => {
  const { rows } = await pool.query<{ createdAt: number }>(
    `select ${epochMillisecondsOf("created_at")} as "createdAt"
     from customer_accounts where id = $1`,
    [id]
  );
  return rows[0]?.createdAt;
};

type StoredAccountCreatedEvent = {
  readonly occurredAt: number;
  readonly recordedAt: number;
  readonly processed: boolean;
};

const accountCreatedEvents = async (pool: Pool, accountId: string) => {
  const { rows } = await pool.query<StoredAccountCreatedEvent>(
    `select ${epochMillisecondsOf("occurred_at")} as "occurredAt",
            ${epochMillisecondsOf("recorded_at")} as "recordedAt",
            automation_processed_at is not null as processed
     from customer_events
     where kind = 'account-created' and customer_account_id = $1`,
    [accountId]
  );
  return rows;
};

/** Every account and event, to tell whether a statement changed anything. */
const storedState = async (pool: Pool) => {
  const { rows } = await pool.query<{ state: unknown }>(
    `select json_build_object(
       'accounts', (select json_agg(a order by a.id) from customer_accounts a),
       'events', (select json_agg(e order by e.id) from customer_events e)
     ) as state`
  );
  return rows[0]?.state;
};

// Millisecond instants, so stored timestamps compare exactly.
const now = Temporal.Instant.fromEpochMilliseconds(Date.now());
const daysBefore = (days: number) => now.subtract({ hours: days * 24 });
const backfilledAt = now.subtract({ hours: 1 });

const customerId = (name: string) =>
  DotyposCustomerIdSchema.make(`repair-${name}`);

describe.skipIf(!testDatabaseUrl)("account creation repair migration", () => {
  test("dates backfilled accounts and their events from their logins", async () => {
    const oldLogin = daysBefore(730);
    const recentLogin = daysBefore(10);
    const signedUpAt = daysBefore(2);
    const freshAt = daysBefore(3);
    const stampedAt = daysBefore(4);
    const stampedLogin = stampedAt.subtract({ milliseconds: 5 });
    const recordedEventAt = backfilledAt.add({ minutes: 5 });
    await migrateAcross({
      seed: async (pool) => {
        // Backfilled, linked and verified; the reconciler recorded its event
        // at the backfill time.
        await insertAccount(pool, "recorded", {
          createdAt: backfilledAt,
          customerId: customerId("recorded"),
        });
        await insertLogin(pool, "recorded", oldLogin);
        await insertAccountCreatedEvent(
          pool,
          "recorded",
          customerId("recorded"),
          backfilledAt,
          recordedEventAt
        );
        // Backfilled, linked, and still without an event.
        await insertAccount(pool, "unrecorded", {
          createdAt: backfilledAt,
          customerId: customerId("unrecorded"),
        });
        await insertLogin(pool, "unrecorded", recentLogin);
        await insertAccount(pool, "unverified", {
          createdAt: backfilledAt,
          customerId: customerId("unverified"),
        });
        await insertLogin(pool, "unverified", recentLogin, false);
        // Backfilled without a customer: it can't have an event.
        await insertAccount(pool, "unlinked", { createdAt: backfilledAt });
        await insertLogin(pool, "unlinked", recentLogin);
        // A sign-up creates its account just before its login.
        await insertAccount(pool, "signup", {
          createdAt: signedUpAt,
          customerId: customerId("signup"),
        });
        await insertLogin(pool, "signup", signedUpAt.add({ seconds: 1 }));
        await insertAccountCreatedEvent(
          pool,
          "signup",
          customerId("signup"),
          signedUpAt
        );
        // A sign-up whose event the outbox missed.
        // Better Auth can stamp a login a moment before the account the
        // sign-up hook inserts; the account then takes the login's time.
        await insertAccount(pool, "stamped", {
          createdAt: stampedAt,
          customerId: customerId("stamped"),
        });
        await insertLogin(pool, "stamped", stampedLogin);
        await insertAccountCreatedEvent(
          pool,
          "stamped",
          customerId("stamped"),
          stampedAt
        );
        await insertAccount(pool, "fresh", {
          createdAt: freshAt,
          customerId: customerId("fresh"),
        });
        await insertLogin(pool, "fresh", freshAt.add({ seconds: 1 }));
        await insertAccount(pool, "tombstone", {
          createdAt: backfilledAt,
          deletedAt: backfilledAt,
        });
        await insertLogin(pool, "tombstone", recentLogin);
      },
      check: async ({ pool, layer }) => {
        expect(await accountCreatedAt(pool, "recorded")).toBe(
          oldLogin.epochMilliseconds
        );
        for (const id of ["unrecorded", "unverified", "unlinked"]) {
          expect(await accountCreatedAt(pool, id)).toBe(
            recentLogin.epochMilliseconds
          );
        }
        expect(await accountCreatedAt(pool, "signup")).toBe(
          signedUpAt.epochMilliseconds
        );
        expect(await accountCreatedAt(pool, "fresh")).toBe(
          freshAt.epochMilliseconds
        );
        expect(await accountCreatedAt(pool, "tombstone")).toBe(
          backfilledAt.epochMilliseconds
        );

        // The recorded event moves with its account and keeps the rest.
        expect(await accountCreatedEvents(pool, "recorded")).toEqual([
          {
            occurredAt: oldLogin.epochMilliseconds,
            recordedAt: recordedEventAt.epochMilliseconds,
            processed: false,
          },
        ]);
        for (const id of ["unrecorded", "unverified"]) {
          expect(await accountCreatedEvents(pool, id)).toEqual([
            {
              occurredAt: recentLogin.epochMilliseconds,
              recordedAt: expect.any(Number),
              processed: true,
            },
          ]);
        }
        expect(await accountCreatedEvents(pool, "unlinked")).toEqual([]);
        expect(await accountCreatedEvents(pool, "signup")).toEqual([
          {
            occurredAt: signedUpAt.epochMilliseconds,
            recordedAt: signedUpAt.epochMilliseconds,
            processed: false,
          },
        ]);
        expect(await accountCreatedEvents(pool, "tombstone")).toEqual([]);
        expect(await accountCreatedAt(pool, "stamped")).toBe(
          stampedLogin.epochMilliseconds
        );
        expect(await accountCreatedEvents(pool, "stamped")).toEqual([
          {
            occurredAt: stampedLogin.epochMilliseconds,
            recordedAt: stampedAt.epochMilliseconds,
            processed: false,
          },
        ]);

        // The reconciler records only the sign-up the outbox missed, even
        // once the backfilled login is verified.
        const reconcile = () =>
          Effect.runPromise(
            TestClock.setTime(now.epochMilliseconds).pipe(
              Effect.andThen(
                Effect.flatMap(
                  CustomerEventReconciler,
                  (reconciler) => reconciler.reconcile
                )
              ),
              Effect.provide(
                Layer.merge(
                  CustomerEventReconciler.Default.pipe(Layer.provide(layer)),
                  TestClock.layer()
                )
              )
            )
          );
        expect((await reconcile()).accountCreated).toBe(1);
        expect(await accountCreatedEvents(pool, "fresh")).toHaveLength(1);
        await pool.query(
          `update auth."user" set email_verified = true where id = 'unverified'`
        );
        expect((await reconcile()).accountCreated).toBe(0);
        for (const id of ["unrecorded", "unverified"]) {
          expect(await accountCreatedEvents(pool, id)).toHaveLength(1);
        }

        // An old login backfilled an hour ago wasn't created this week.
        const lastWeek = await Effect.runPromise(
          CampaignCandidateRepository.pipe(
            Effect.flatMap((candidates) =>
              candidates.accountCreations({
                created: { startsAtOrAfter: daysBefore(7) },
                asOf: now,
              })
            ),
            Effect.provide(CampaignCandidateRepository.Default),
            Effect.provide(layer)
          )
        );
        expect(lastWeek.withValue.has(customerId("recorded"))).toBe(true);
        expect(lastWeek.inPeriod.has(customerId("recorded"))).toBe(false);
        expect(lastWeek.inPeriod.has(customerId("unrecorded"))).toBe(false);
        expect(lastWeek.inPeriod.has(customerId("signup"))).toBe(true);
        expect(lastWeek.inPeriod.has(customerId("fresh"))).toBe(true);

        // Running the migration again changes nothing.
        const repaired = await storedState(pool);
        expect((await rerunMigration(pool)).at(-1)).toBe(0);
        expect(await storedState(pool)).toEqual(repaired);
      },
    });
  });

  test("moves an event the reconciler commits while the repair runs", async () => {
    const login = daysBefore(10);
    await migrateAcross({
      seed: async (pool) => {
        await insertAccount(pool, "racing", {
          createdAt: backfilledAt,
          customerId: customerId("racing"),
        });
        await insertLogin(pool, "racing", login);
      },
      // The reconciler records the event at the account's backfill time.
      alongside: {
        sql: `insert into customer_events
                (kind, occurred_at, dotypos_customer_id, customer_account_id)
              select 'account-created', created_at, dotypos_customer_id, id
              from customer_accounts where id = $1`,
        values: ["racing"],
      },
      check: async ({ pool }) => {
        expect(await accountCreatedAt(pool, "racing")).toBe(
          login.epochMilliseconds
        );
        expect(await accountCreatedEvents(pool, "racing")).toEqual([
          {
            occurredAt: login.epochMilliseconds,
            recordedAt: expect.any(Number),
            processed: false,
          },
        ]);
      },
    });
  });

  test("moves the event of a first link committed while the repair runs", async () => {
    const login = daysBefore(10);
    await migrateAcross({
      seed: async (pool) => {
        await insertAccount(pool, "linking", { createdAt: backfilledAt });
        await insertLogin(pool, "linking", login);
      },
      // The first link records the event at the account's backfill time.
      alongside: {
        sql: `with linked as (
                update customer_accounts set dotypos_customer_id = $1
                where id = $2
                returning id, created_at, dotypos_customer_id
              )
              insert into customer_events
                (kind, occurred_at, dotypos_customer_id, customer_account_id)
              select 'account-created', created_at, dotypos_customer_id, id
              from linked`,
        values: [customerId("linking"), "linking"],
      },
      check: async ({ pool }) => {
        expect(await accountCreatedAt(pool, "linking")).toBe(
          login.epochMilliseconds
        );
        expect(await accountCreatedEvents(pool, "linking")).toEqual([
          {
            occurredAt: login.epochMilliseconds,
            recordedAt: expect.any(Number),
            processed: false,
          },
        ]);
      },
    });
  });

  test(
    "repairs a production-sized account table in one statement",
    async () => {
      // About 47k Dotypos customers got silent logins in #764, beside the
      // logins that were backfilled accounts. Every fifth login here predates
      // its account, and every second of those is linked.
      const logins = 50_000;
      const oldLogin = daysBefore(400);
      await migrateAcross({
        seed: async (pool) => {
          await pool.query(
            `insert into customer_accounts (id, created_at, dotypos_customer_id)
             select 'scale-' || g, $1::timestamptz,
                    case when g % 10 = 0 then 'scale-customer-' || g end
             from generate_series(1, $2::int) g`,
            [instantParameter(backfilledAt), logins]
          );
          await pool.query(
            `insert into auth."user" (id, name, email, email_verified, created_at)
             select 'scale-' || g, '', 'repair-scale-' || g || '@' || $4, true,
                    case when g % 5 = 0 then $1::timestamptz
                         else $2::timestamptz end
             from generate_series(1, $3::int) g`,
            [
              instantParameter(oldLogin),
              instantParameter(backfilledAt.add({ seconds: 1 })),
              logins,
              EMAIL_TEST_DOMAIN,
            ]
          );
        },
        check: async ({ pool }) => {
          const { rows } = await pool.query<{
            repaired: number;
            events: number;
          }>(
            `select
               (select count(*)::int from customer_accounts
                where created_at = $1::timestamptz) as repaired,
               (select count(*)::int from customer_events
                where kind = 'account-created' and occurred_at = $1::timestamptz
                  and automation_processed_at is not null) as events`,
            [instantParameter(oldLogin)]
          );
          expect(rows[0]).toEqual({
            repaired: logins / 5,
            events: logins / 10,
          });
        },
      });
    },
    { timeout: 120_000 }
  );
});
