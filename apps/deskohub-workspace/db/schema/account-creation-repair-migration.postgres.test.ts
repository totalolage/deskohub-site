import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { EMAIL_TEST_DOMAIN, testEmailAddress } from "@deskohub/test-email";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import type { Pool } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import { makeDatabaseClient, makeDatabasePool } from "@/db/database-client";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { customerEvents } from "@/db/schema";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { triggeringCustomerEvent } from "@/features/email-campaigns/automation/backend/automation-triggering-events";
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

const MIGRATION_DIR = "20261021164704_automation_account_creation";

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
      layer: Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(db)),
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

/**
 * A login, opening its first session at `signedInAt`: a sign-in creates a
 * login with its session, while #764's backfill left its logins without one.
 */
const insertLogin = async (
  pool: Pool,
  id: string,
  createdAt: Temporal.Instant,
  {
    verified = true,
    signedInAt,
  }: {
    readonly verified?: boolean;
    readonly signedInAt?: Temporal.Instant;
  } = {}
) => {
  await pool.query(
    `insert into auth."user" (id, name, email, email_verified, created_at)
     values ($1, '', $2, $3, $4)`,
    [
      id,
      testEmailAddress(`repair-${id}`),
      verified,
      instantParameter(createdAt),
    ]
  );
  if (signedInAt) {
    await pool.query(
      `insert into auth.session (id, expires_at, token, created_at, updated_at, user_id)
       values ($1, $2::timestamptz + interval '7 days', $1, $2, $2, $3)`,
      [`session-${id}`, instantParameter(signedInAt), id]
    );
  }
};

const insertAccountCreatedEvent = (
  pool: Pool,
  accountId: string,
  customerId: string,
  occurredAt: Temporal.Instant,
  recordedAt = occurredAt,
  processedAt?: Temporal.Instant
) =>
  pool.query(
    `insert into customer_events
       (kind, occurred_at, recorded_at, dotypos_customer_id, customer_account_id,
        automation_processed_at)
     values ('account-created', $1, $2, $3, $4, $5)`,
    [
      instantParameter(occurredAt),
      instantParameter(recordedAt),
      customerId,
      accountId,
      processedAt ? instantParameter(processedAt) : null,
    ]
  );

/** A Workspace reservation the account authors, booked at `createdAt`. */
const insertAuthoredReservation = (
  pool: Pool,
  accountId: string,
  customerId: string,
  createdAt: Temporal.Instant
) =>
  pool.query(
    `insert into workspace_reservations
       (checkout_attempt_key, dotypos_customer_id, author_account_id,
        reservation_state, payment_state, fulfillment_state,
        reservation_details, locale, created_at)
     values ($1, $2, $3, 'draft', 'not_started', 'not_started',
       '{"kind":"cowork","entryTier":"basic","coffee":false}', 'en-US', $4)`,
    [
      `attempt:${crypto.randomUUID()}`,
      customerId,
      accountId,
      instantParameter(createdAt),
    ]
  );

const epochMillisecondsOf = (column: string) =>
  `(extract(epoch from ${column}) * 1000)::float8`;

const isLegacy = async (pool: Pool, id: string) => {
  const { rows } = await pool.query<{ legacy: boolean }>(
    "select legacy from customer_accounts where id = $1",
    [id]
  );
  return rows[0]?.legacy;
};

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

// Fixed millisecond instants, so stored timestamps compare exactly and
// every login stays on its side of the window #764's backfill could run in,
// from its merge (2026-10-20T17:32:49Z) to the end the migration allows.
const backfillWindowStartsAt = Temporal.Instant.from("2026-10-20T17:32:49Z");
const backfilledAt = Temporal.Instant.from("2026-10-20T18:30:00Z");
const backfillWindowEndsAt = Temporal.Instant.from("2026-10-20T19:10:00Z");
const now = backfilledAt.add({ hours: 40 });
const daysBefore = (days: number) => now.subtract({ hours: days * 24 });
// Better Auth stamps a login before its hook inserts the account.
const silentLoginAt = backfilledAt.subtract({ milliseconds: 3 });
const reconciledAt = backfilledAt.add({ hours: 20 });
const repairedAt = backfilledAt.add({ hours: 30 });
const lateSignUpAt = backfilledAt.add({ minutes: 20 });
const beforeBackfillAt = backfillWindowStartsAt.subtract({ milliseconds: 1 });
const afterBackfillAt = backfillWindowEndsAt.add({ milliseconds: 1 });

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
        await insertLogin(pool, "unverified", recentLogin, { verified: false });
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
        // Existing customers' silent logins, one already signed in to.
        await insertAccount(pool, "legacy", {
          createdAt: backfilledAt,
          customerId: customerId("legacy"),
        });
        await insertLogin(pool, "legacy", silentLoginAt, { verified: false });
        await insertAccount(pool, "legacy-verified", {
          createdAt: backfilledAt,
          customerId: customerId("legacy-verified"),
        });
        await insertLogin(pool, "legacy-verified", silentLoginAt, {
          signedInAt: reconciledAt,
        });
        // Silent logins whose link #764 lost to a conflict: one never signed
        // in to, two signed in to while the customer was still held (one
        // seconds after the backfill made it), and one that claimed its
        // customer at a sign-in once it was free.
        await insertAccount(pool, "legacy-unlinked", {
          createdAt: backfilledAt,
        });
        await insertLogin(pool, "legacy-unlinked", silentLoginAt, {
          verified: false,
        });
        await insertAccount(pool, "legacy-unlinked-verified", {
          createdAt: backfilledAt,
        });
        await insertLogin(pool, "legacy-unlinked-verified", silentLoginAt, {
          signedInAt: reconciledAt,
        });
        await insertAccount(pool, "legacy-quickly-verified", {
          createdAt: backfilledAt,
        });
        await insertLogin(pool, "legacy-quickly-verified", silentLoginAt, {
          signedInAt: silentLoginAt.add({ seconds: 15 }),
        });
        await insertAccount(pool, "legacy-claimed", {
          createdAt: backfilledAt,
          customerId: customerId("legacy-claimed"),
        });
        await insertLogin(pool, "legacy-claimed", silentLoginAt, {
          signedInAt: reconciledAt,
        });
        await insertAccountCreatedEvent(
          pool,
          "legacy-claimed",
          customerId("legacy-claimed"),
          backfilledAt,
          reconciledAt
        );
        // Existing customers' silent logins that already have an event. The
        // backfill made each the author of the guest bookings it was for.
        // The reconciler recorded one's event once its owner signed in, at
        // the backfill time.
        await insertAccount(pool, "legacy-reconciled", {
          createdAt: backfilledAt,
          customerId: customerId("legacy-reconciled"),
        });
        await insertLogin(pool, "legacy-reconciled", silentLoginAt);
        await insertAuthoredReservation(
          pool,
          "legacy-reconciled",
          customerId("legacy-reconciled"),
          daysBefore(60)
        );
        await insertAccountCreatedEvent(
          pool,
          "legacy-reconciled",
          customerId("legacy-reconciled"),
          backfilledAt,
          reconciledAt
        );
        // An earlier version of the repair, on a preview database, dated
        // the other's account from its login and recorded a processed event.
        await insertAccount(pool, "legacy-repaired", {
          createdAt: silentLoginAt,
          customerId: customerId("legacy-repaired"),
        });
        await insertLogin(pool, "legacy-repaired", silentLoginAt);
        await insertAuthoredReservation(
          pool,
          "legacy-repaired",
          customerId("legacy-repaired"),
          daysBefore(90)
        );
        await insertAccountCreatedEvent(
          pool,
          "legacy-repaired",
          customerId("legacy-repaired"),
          silentLoginAt,
          repairedAt,
          repairedAt
        );
        // Sign-ups while the backfill could still run: one claimed its
        // customer, one hasn't.
        await insertAccount(pool, "late-signup", {
          createdAt: lateSignUpAt,
          customerId: customerId("late-signup"),
        });
        await insertLogin(pool, "late-signup", lateSignUpAt, {
          signedInAt: lateSignUpAt,
        });
        await insertAccountCreatedEvent(
          pool,
          "late-signup",
          customerId("late-signup"),
          lateSignUpAt
        );
        await insertAuthoredReservation(
          pool,
          "late-signup",
          customerId("late-signup"),
          lateSignUpAt.add({ minutes: 10 })
        );
        await insertAccount(pool, "late-pending", { createdAt: lateSignUpAt });
        // Its sign-in opened the session a moment after making the login.
        await insertLogin(pool, "late-pending", lateSignUpAt, {
          signedInAt: lateSignUpAt.add({ seconds: 2 }),
        });
        // Unverified logins without a session at each end of the window and
        // just outside it. One after it may be a sign-up still in progress.
        await insertAccount(pool, "legacy-first", {
          createdAt: backfillWindowStartsAt,
        });
        await insertLogin(pool, "legacy-first", backfillWindowStartsAt, {
          verified: false,
        });
        await insertAccount(pool, "before-backfill", {
          createdAt: beforeBackfillAt,
        });
        await insertLogin(pool, "before-backfill", beforeBackfillAt, {
          verified: false,
        });
        await insertAccount(pool, "legacy-last", {
          createdAt: backfillWindowEndsAt,
        });
        await insertLogin(pool, "legacy-last", backfillWindowEndsAt, {
          verified: false,
        });
        await insertAccount(pool, "after-backfill", {
          createdAt: afterBackfillAt,
        });
        await insertLogin(pool, "after-backfill", afterBackfillAt, {
          verified: false,
        });
      },
      check: async ({ pool, layer }) => {
        for (const id of [
          "legacy",
          "legacy-verified",
          "legacy-unlinked",
          "legacy-unlinked-verified",
          "legacy-quickly-verified",
        ]) {
          expect(await isLegacy(pool, id)).toBe(true);
          // No real creation time exists to repair to.
          expect(await accountCreatedAt(pool, id)).toBe(
            backfilledAt.epochMilliseconds
          );
          expect(await accountCreatedEvents(pool, id)).toEqual([]);
        }
        // An event doesn't make an existing customer new; it keeps its
        // account's time, and intake and replay never take it in.
        expect(await isLegacy(pool, "legacy-reconciled")).toBe(true);
        expect(await accountCreatedAt(pool, "legacy-reconciled")).toBe(
          backfilledAt.epochMilliseconds
        );
        expect(await accountCreatedEvents(pool, "legacy-reconciled")).toEqual([
          {
            occurredAt: backfilledAt.epochMilliseconds,
            recordedAt: reconciledAt.epochMilliseconds,
            processed: false,
          },
        ]);
        expect(await isLegacy(pool, "legacy-claimed")).toBe(true);
        expect(await accountCreatedAt(pool, "legacy-claimed")).toBe(
          backfilledAt.epochMilliseconds
        );
        expect(await accountCreatedEvents(pool, "legacy-claimed")).toEqual([
          {
            occurredAt: backfilledAt.epochMilliseconds,
            recordedAt: reconciledAt.epochMilliseconds,
            processed: false,
          },
        ]);
        expect(await isLegacy(pool, "legacy-repaired")).toBe(true);
        expect(await accountCreatedAt(pool, "legacy-repaired")).toBe(
          silentLoginAt.epochMilliseconds
        );
        expect(await accountCreatedEvents(pool, "legacy-repaired")).toEqual([
          {
            occurredAt: silentLoginAt.epochMilliseconds,
            recordedAt: repairedAt.epochMilliseconds,
            processed: true,
          },
        ]);
        for (const id of [
          "recorded",
          "unrecorded",
          "unverified",
          "unlinked",
          "signup",
          "stamped",
          "fresh",
          "tombstone",
          "late-signup",
          "late-pending",
          "before-backfill",
          "after-backfill",
        ]) {
          expect(await isLegacy(pool, id)).toBe(false);
        }
        for (const id of ["legacy-first", "legacy-last"]) {
          expect(await isLegacy(pool, id)).toBe(true);
        }
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
          `update auth."user" set email_verified = true
           where id in ('unverified', 'legacy')`
        );
        expect((await reconcile()).accountCreated).toBe(0);
        for (const id of ["unrecorded", "unverified"]) {
          expect(await accountCreatedEvents(pool, id)).toHaveLength(1);
        }
        // An existing customer's first sign-in records no account creation.
        for (const id of ["legacy", "legacy-verified"]) {
          expect(await accountCreatedEvents(pool, id)).toEqual([]);
        }

        // Once its customer is free, the unlinked one's owner signs in and
        // claims it: it stays an existing customer and records nothing. A
        // sign-up claiming its customer records its creation.
        await pool.query(
          `update auth."user" set email_verified = true
           where id = 'legacy-unlinked'`
        );
        const claim = (id: string) =>
          Effect.runPromise(
            Effect.flatMap(CustomerAccountLinkRepository, (links) =>
              links.claim(customerAccountIdSchema.make(id), customerId(id))
            ).pipe(
              Effect.provide(
                CustomerAccountLinkRepository.Default.pipe(
                  Layer.provide(
                    Layer.merge(
                      layer,
                      WorkspaceDatabaseAdvisoryLock.makeLayer(pool)
                    )
                  )
                )
              )
            )
          );
        for (const id of ["legacy-unlinked", "late-pending"]) {
          expect(await claim(id)).toEqual({
            kind: "linked",
            customerId: customerId(id),
            created: true,
          });
        }
        expect(await isLegacy(pool, "legacy-unlinked")).toBe(true);
        expect(await accountCreatedEvents(pool, "legacy-unlinked")).toEqual([]);
        expect(await isLegacy(pool, "late-pending")).toBe(false);
        expect(await accountCreatedEvents(pool, "late-pending")).toEqual([
          {
            occurredAt: lateSignUpAt.epochMilliseconds,
            recordedAt: expect.any(Number),
            processed: false,
          },
        ]);

        // A legacy account's event starts nothing.
        const db = await Effect.runPromise(
          Effect.map(WorkspaceDatabase, ({ db }) => db).pipe(
            Effect.provide(layer)
          )
        );
        expect(
          await Effect.runPromise(
            db
              .select({
                accountId: customerEvents.customerAccountId,
                triggering: triggeringCustomerEvent,
              })
              .from(customerEvents)
              .where(
                inArray(customerEvents.customerAccountId, [
                  customerAccountIdSchema.make("legacy-claimed"),
                  customerAccountIdSchema.make("late-pending"),
                ])
              )
              .orderBy(customerEvents.customerAccountId)
          )
        ).toEqual([
          { accountId: "late-pending", triggering: true },
          { accountId: "legacy-claimed", triggering: false },
        ]);

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
        expect(lastWeek.inPeriod.has(customerId("late-signup"))).toBe(true);
        expect(lastWeek.inPeriod.has(customerId("late-pending"))).toBe(true);
        // A legacy customer verified a day after the backfill is old.
        for (const id of [
          "legacy",
          "legacy-verified",
          "legacy-unlinked",
          "legacy-claimed",
          "legacy-reconciled",
          "legacy-repaired",
        ]) {
          expect(lastWeek.withValue.has(customerId(id))).toBe(true);
          expect(lastWeek.inPeriod.has(customerId(id))).toBe(false);
        }

        // Running the migration again changes nothing.
        const repaired = await storedState(pool);
        expect((await rerunMigration(pool)).slice(2)).toEqual([0, 0]);
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

  test("keeps a sign-up whose first session commits after the migration new", async () => {
    const id = "in-progress";
    const loginAt = backfillWindowEndsAt.add({ hours: 30 });
    await migrateAcross({
      seed: async (pool) => {
        // The sign-up hook commits the account, stamped a moment after the
        // login, and Better Auth commits the verified login before it
        // creates the first session.
        await insertAccount(pool, id, {
          createdAt: loginAt.add({ milliseconds: 5 }),
        });
        await insertLogin(pool, id, loginAt);
      },
      check: async ({ pool, layer }) => {
        await pool.query(
          `insert into auth.session (id, expires_at, token, created_at, updated_at, user_id)
           values ($1, $2::timestamptz + interval '7 days', $1, $2, $2, $3)`,
          [`session-${id}`, instantParameter(loginAt.add({ seconds: 2 })), id]
        );
        expect(
          await Effect.runPromise(
            Effect.flatMap(CustomerAccountLinkRepository, (links) =>
              links.claim(customerAccountIdSchema.make(id), customerId(id))
            ).pipe(
              Effect.provide(
                CustomerAccountLinkRepository.Default.pipe(
                  Layer.provide(
                    Layer.merge(
                      layer,
                      WorkspaceDatabaseAdvisoryLock.makeLayer(pool)
                    )
                  )
                )
              )
            )
          )
        ).toEqual({
          kind: "linked",
          customerId: customerId(id),
          created: true,
        });
        expect(await isLegacy(pool, id)).toBe(false);
        expect(await accountCreatedEvents(pool, id)).toEqual([
          {
            occurredAt: loginAt.epochMilliseconds,
            recordedAt: expect.any(Number),
            processed: false,
          },
        ]);

        // Running the migration again changes nothing.
        const claimed = await storedState(pool);
        expect((await rerunMigration(pool)).slice(2)).toEqual([0, 0]);
        expect(await storedState(pool)).toEqual(claimed);
      },
    });
  });

  test(
    "repairs and marks a large account table",
    async () => {
      // A synthetic stress case: production's backfill made 53 silent
      // logins, far fewer than this table holds. Every fifth login predates
      // its account; the rest are stamped as a silent login is, without a
      // session, so they are legacy whether linked or not. Every second
      // account is linked; each linked silent login authors a guest booking
      // from before the backfill and already has the event the reconciler
      // recorded once its owner signed in.
      const logins = 50_000;
      const oldLogin = daysBefore(400);
      await migrateAcross({
        seed: async (pool) => {
          await pool.query(
            `insert into customer_accounts (id, created_at, dotypos_customer_id)
             select 'scale-' || g, $1::timestamptz,
                    case when g % 2 = 0 then 'scale-customer-' || g end
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
              instantParameter(silentLoginAt),
              logins,
              EMAIL_TEST_DOMAIN,
            ]
          );
          await pool.query(
            `insert into workspace_reservations
               (checkout_attempt_key, dotypos_customer_id, author_account_id,
                reservation_state, payment_state, fulfillment_state,
                reservation_details, locale, created_at)
             select 'scale-attempt-' || g, 'scale-customer-' || g, 'scale-' || g,
                    'draft', 'not_started', 'not_started',
                    '{"kind":"cowork","entryTier":"basic","coffee":false}',
                    'en-US', $1::timestamptz
             from generate_series(1, $2::int) g
             where g % 2 = 0 and g % 5 <> 0`,
            [instantParameter(oldLogin), logins]
          );
          await pool.query(
            `insert into customer_events
               (kind, occurred_at, recorded_at, dotypos_customer_id,
                customer_account_id)
             select 'account-created', $1::timestamptz, $2::timestamptz,
                    'scale-customer-' || g, 'scale-' || g
             from generate_series(1, $3::int) g
             where g % 2 = 0 and g % 5 <> 0`,
            [
              instantParameter(backfilledAt),
              instantParameter(reconciledAt),
              logins,
            ]
          );
        },
        check: async ({ pool }) => {
          const { rows } = await pool.query<{
            repaired: number;
            legacy: number;
            events: number;
          }>(
            `select
               (select count(*)::int from customer_accounts
                where created_at = $1::timestamptz) as repaired,
               (select count(*)::int from customer_accounts
                where legacy) as legacy,
               (select count(*)::int from customer_events
                where kind = 'account-created' and occurred_at = $1::timestamptz
                  and automation_processed_at is not null) as events`,
            [instantParameter(oldLogin)]
          );
          expect(rows[0]).toEqual({
            repaired: logins / 5,
            legacy: logins - logins / 5,
            events: logins / 10,
          });
        },
      });
    },
    { timeout: 120_000 }
  );
});
