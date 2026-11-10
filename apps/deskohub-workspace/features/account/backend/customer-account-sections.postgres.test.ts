import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option } from "effect";
import { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { connectUnreachableWorkspaceDatabase } from "@/shared/testing/unreachable-workspace-database.test-utils";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { waitForAccountAdvisoryLockWait } from "./customer-account-lock.test-utils";
import {
  CustomerAccountSections,
  HeldCustomerAccount,
} from "./customer-account-sections";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";
import { testSessionProfile } from "./customer-authentication.test-utils";

const suiteDatabase = await createWorkspacePostgresSuiteDatabase(
  "customer_account_sections"
);

describe.skipIf(!suiteDatabase)(
  "CustomerAccountSections on disposable Postgres",
  () => {
    if (!suiteDatabase) return;
    const { pool } = suiteDatabase;

    afterAll(() => suiteDatabase.close());

    const healthyAdvisoryLock = WorkspaceDatabaseAdvisoryLock.makeLayer(pool);

    /** What the faked session authority answers on every read. */
    type SessionAnswer =
      | CustomerAccountSession
      | null
      | CustomerAccountAccessError;

    /**
     * The real sections over the real account repository and advisory lock,
     * with the session authority faked. `reads` counts session reads.
     */
    const makeSections = (
      session: SessionAnswer,
      advisoryLock: Layer.Layer<WorkspaceDatabaseAdvisoryLock> = healthyAdvisoryLock
    ) => {
      const reads = { session: 0 };
      const currentUser = Effect.suspend(() => {
        reads.session += 1;
        return session instanceof CustomerAccountAccessError
          ? Effect.fail(session)
          : Effect.succeed(session);
      });
      const layer = CustomerAccountSections.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(CustomerAuthentication, { currentUser }),
            CustomerAccountLinkRepository.Default.pipe(
              Layer.provide(suiteDatabase.layer)
            ),
            advisoryLock
          )
        )
      );
      return { reads, layer };
    };

    const run = <A, E>(
      layer: Layer.Layer<CustomerAccountSections>,
      effect: Effect.Effect<A, E, CustomerAccountSections>
    ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

    /** The failure of `effect`; it rejects when `effect` succeeds. */
    const failureOf = <A, E>(
      layer: Layer.Layer<CustomerAccountSections>,
      effect: Effect.Effect<A, E, CustomerAccountSections>
    ) => run(layer, Effect.flip(effect));

    const seedAccount = async (options: { deletionRequested?: boolean } = {}) =>
      Effect.runPromise(
        workspaceFixtures(suiteDatabase.db).account("sections", options)
      );

    const sessionFor = (account: {
      readonly accountId: CustomerAccountId;
      readonly email: string;
    }): CustomerAccountSession => ({
      accountId: account.accountId,
      email: reservationCustomerEmailSchema.make(account.email),
      deletionRequested: false,
      ...testSessionProfile,
    });

    /** An account ID with no login row. */
    const unknownAccountId = () =>
      customerAccountIdSchema.make(crypto.randomUUID());

    const loginEmail = async (accountId: CustomerAccountId) =>
      (
        await pool.query<{ email: string }>(
          `select email from auth."user" where id = $1`,
          [accountId]
        )
      ).rows[0]?.email;

    /**
     * Whether another connection can take the account's lock now; a
     * statement-scoped try-lock that releases it at once.
     */
    const freeElsewhereNow = async (accountId: CustomerAccountId) => {
      const { rows } = await pool.query<{ free: boolean }>(
        `select pg_try_advisory_xact_lock(hashtext('customer-account'), hashtext($1)) as free`,
        [accountId]
      );
      return rows[0]!.free;
    };
    const freeElsewhere = (accountId: CustomerAccountId) =>
      Effect.promise(() => freeElsewhereNow(accountId));

    /** Granted and waiting `pg_locks` rows for the account's lock key. */
    const accountLockRows = (accountId: CustomerAccountId) =>
      Effect.promise(async () => {
        const { rows } = await pool.query<{
          granted: number;
          waiting: number;
        }>(
          `select count(*) filter (where granted)::int as granted,
                  count(*) filter (where not granted)::int as waiting
             from pg_locks
            where locktype = 'advisory'
              and classid::bigint = (hashtext('customer-account')::bigint & 4294967295)
              and objid::bigint = (hashtext($1)::bigint & 4294967295)
              and objsubid = 2`,
          [accountId]
        );
        return rows[0]!;
      });

    /** A defect whose report contains `fragment`. */
    const dies = (exit: Exit.Exit<unknown, unknown>, fragment: string) =>
      Exit.isFailure(exit) &&
      Cause.hasDies(exit.cause) &&
      Cause.pretty(exit.cause).includes(fragment);

    const sections = Effect.service(CustomerAccountSections);

    describe("holding the lock", () => {
      test("holds the account lock for the section, so another connection waits, and releases it after", async () => {
        const account = await seedAccount();
        const { layer } = makeSections(null);
        let contenderRan = false;

        const outcome = await run(
          layer,
          Effect.gen(function* () {
            const { withActiveAccount } = yield* sections;
            const held = yield* Deferred.make<void>();
            const gate = yield* Deferred.make<void>();

            const holder = yield* Effect.forkChild(
              withActiveAccount(
                account.accountId,
                Deferred.succeed(held, undefined).pipe(
                  Effect.andThen(Deferred.await(gate)),
                  Effect.andThen(freeElsewhere(account.accountId))
                ),
                { recheck: "active" }
              )
            );
            yield* Deferred.await(held);
            const freeWhileHeld = yield* freeElsewhere(account.accountId);

            const contender = yield* Effect.forkChild(
              withActiveAccount(
                account.accountId,
                Effect.sync(() => {
                  contenderRan = true;
                }),
                { recheck: "active" }
              )
            );
            yield* Effect.promise(() =>
              waitForAccountAdvisoryLockWait(pool, account.accountId)
            );
            const contenderRanWhileHeld = contenderRan;

            yield* Deferred.succeed(gate, undefined);
            const freeAtSectionEnd = yield* Fiber.join(holder);
            yield* Fiber.join(contender);

            return {
              freeWhileHeld,
              contenderRanWhileHeld,
              freeAtSectionEnd,
              contenderRan,
              freeAfter: yield* freeElsewhere(account.accountId),
            };
          })
        );

        expect(outcome).toEqual({
          freeWhileHeld: false,
          contenderRanWhileHeld: false,
          freeAtSectionEnd: false,
          contenderRan: true,
          freeAfter: true,
        });
      });

      test("a nested section for the same account reuses the hold without a second lock or recheck", async () => {
        const account = await seedAccount();
        const { layer, reads } = makeSections(sessionFor(account));

        const outcome = await run(
          layer,
          Effect.gen(function* () {
            const { withActiveAccount } = yield* sections;
            return yield* withActiveAccount(
              account.accountId,
              Effect.gen(function* () {
                const outer = yield* HeldCustomerAccount;
                const inner = yield* withActiveAccount(
                  account.accountId,
                  Effect.all({
                    held: Effect.service(HeldCustomerAccount),
                    lock: accountLockRows(account.accountId),
                  })
                );
                return { outer, inner };
              })
            );
          })
        );

        expect(outcome.inner.held).toBe(outcome.outer);
        expect(outcome.inner.lock).toEqual({ granted: 1, waiting: 0 });
        expect(reads.session).toBe(1);
        expect(await freeElsewhereNow(account.accountId)).toBe(true);
      });

      test("a nested section for another account takes its own lock in ascending key order", async () => {
        const [first, second] = (
          await Promise.all([seedAccount(), seedAccount()])
        ).sort((a, b) => (a.accountId < b.accountId ? -1 : 1));
        const { layer } = makeSections(null);

        const outcome = await run(
          layer,
          Effect.gen(function* () {
            const { withActiveAccount } = yield* sections;
            return yield* withActiveAccount(
              first!.accountId,
              Effect.gen(function* () {
                const inner = yield* withActiveAccount(
                  second!.accountId,
                  Effect.all({
                    held: Effect.service(HeldCustomerAccount),
                    firstFree: freeElsewhere(first!.accountId),
                    secondFree: freeElsewhere(second!.accountId),
                  }),
                  { recheck: "active" }
                );
                return {
                  inner,
                  outerHeld: yield* HeldCustomerAccount,
                  firstFreeAfterInner: yield* freeElsewhere(first!.accountId),
                  secondFreeAfterInner: yield* freeElsewhere(second!.accountId),
                };
              }),
              { recheck: "active" }
            );
          })
        );

        expect(outcome.inner.held.accountId).toBe(second!.accountId);
        expect(outcome.inner.firstFree).toBe(false);
        expect(outcome.inner.secondFree).toBe(false);
        expect(outcome.outerHeld.accountId).toBe(first!.accountId);
        expect(outcome.firstFreeAfterInner).toBe(false);
        expect(outcome.secondFreeAfterInner).toBe(true);
        expect(await freeElsewhereNow(first!.accountId)).toBe(true);
        expect(await freeElsewhereNow(second!.accountId)).toBe(true);
      });

      test("a nested section for another account on a descending key is an ordering defect", async () => {
        const [first, second] = (
          await Promise.all([seedAccount(), seedAccount()])
        ).sort((a, b) => (a.accountId < b.accountId ? -1 : 1));
        const { layer } = makeSections(null);
        let innerRan = false;

        const exit = await Effect.runPromiseExit(
          Effect.gen(function* () {
            const { withActiveAccount } = yield* sections;
            return yield* withActiveAccount(
              second!.accountId,
              withActiveAccount(
                first!.accountId,
                Effect.sync(() => {
                  innerRan = true;
                }),
                { recheck: "active" }
              ),
              { recheck: "active" }
            );
          }).pipe(Effect.provide(layer))
        );

        expect(dies(exit, "out of section order")).toBe(true);
        expect(innerRan).toBe(false);
        expect(await freeElsewhereNow(first!.accountId)).toBe(true);
        expect(await freeElsewhereNow(second!.accountId)).toBe(true);
      });
    });

    describe("rechecking under the lock", () => {
      /** Runs a section for `accountId`, recording whether its work ran. */
      const enter = (
        accountId: CustomerAccountId,
        recheck?: "session" | "active" | "present"
      ) => {
        const ran = { section: false };
        const section = Effect.flatMap(sections, ({ withActiveAccount }) =>
          withActiveAccount(
            accountId,
            Effect.flatMap(HeldCustomerAccount, (held) =>
              Effect.sync(() => {
                ran.section = true;
                return held;
              })
            ),
            recheck === undefined ? undefined : { recheck }
          )
        );
        return { ran, section };
      };

      const expectRejected = async (
        layer: Layer.Layer<CustomerAccountSections>,
        accountId: CustomerAccountId,
        recheck: "session" | "active" | "present" | undefined,
        expected: Pick<CustomerAccountAccessError, "reason" | "linkReason">
      ) => {
        const { ran, section } = enter(accountId, recheck);
        const failure = await failureOf(layer, section);
        expect(failure).toBeInstanceOf(CustomerAccountAccessError);
        expect(failure.reason).toBe(expected.reason);
        expect(failure.linkReason).toBe(expected.linkReason);
        expect(ran.section).toBe(false);
        expect(await freeElsewhereNow(accountId)).toBe(true);
      };

      const unauthenticated = {
        reason: "unauthenticated",
        linkReason: undefined,
      } as const;
      const deletionRequested = {
        reason: "link-required",
        linkReason: "deletion-requested",
      } as const;

      test("session, by default, accepts the account's own session and holds its login email", async () => {
        const account = await seedAccount();
        const { layer, reads } = makeSections(sessionFor(account));
        const { ran, section } = enter(account.accountId);

        const held = await run(layer, section);

        expect(ran.section).toBe(true);
        expect(held).toEqual({
          accountId: account.accountId,
          email: account.email,
        });
        expect(held.email).toBe((await loginEmail(account.accountId))!);
        expect(reads.session).toBe(1);
      });

      test("session rejects an anonymous session as unauthenticated", async () => {
        const account = await seedAccount();
        await expectRejected(
          makeSections(null).layer,
          account.accountId,
          "session",
          unauthenticated
        );
      });

      test("session rejects another account's session as unauthenticated", async () => {
        const account = await seedAccount();
        const other = await seedAccount();
        await expectRejected(
          makeSections(sessionFor(other)).layer,
          account.accountId,
          "session",
          unauthenticated
        );
      });

      test("session rejects an account without a login row as unauthenticated", async () => {
        const accountId = unknownAccountId();
        await expectRejected(
          makeSections({
            accountId,
            email: reservationCustomerEmailSchema.make(
              testEmailAddress(`missing-${accountId}`)
            ),
            deletionRequested: false,
            ...testSessionProfile,
          }).layer,
          accountId,
          "session",
          unauthenticated
        );
      });

      test("session rejects an account awaiting deletion as link-required", async () => {
        const account = await seedAccount({ deletionRequested: true });
        await expectRejected(
          makeSections(sessionFor(account)).layer,
          account.accountId,
          "session",
          deletionRequested
        );
      });

      test("session checks the session before the deletion marker", async () => {
        const account = await seedAccount({ deletionRequested: true });
        const other = await seedAccount();
        await expectRejected(
          makeSections(sessionFor(other)).layer,
          account.accountId,
          "session",
          unauthenticated
        );
      });

      test("active accepts an active account without reading the session", async () => {
        const account = await seedAccount();
        const { layer, reads } = makeSections(null);
        const { ran, section } = enter(account.accountId, "active");

        const held = await run(layer, section);

        expect(ran.section).toBe(true);
        expect(held).toEqual({
          accountId: account.accountId,
          email: account.email,
        });
        expect(reads.session).toBe(0);
      });

      test("active rejects an account awaiting deletion as link-required", async () => {
        const account = await seedAccount({ deletionRequested: true });
        const { layer, reads } = makeSections(null);
        await expectRejected(
          layer,
          account.accountId,
          "active",
          deletionRequested
        );
        expect(reads.session).toBe(0);
      });

      test("active rejects an account without a login row as unauthenticated", async () => {
        await expectRejected(
          makeSections(null).layer,
          unknownAccountId(),
          "active",
          unauthenticated
        );
      });

      test("present tolerates an account awaiting deletion", async () => {
        const account = await seedAccount({ deletionRequested: true });
        const { layer, reads } = makeSections(null);
        const { ran, section } = enter(account.accountId, "present");

        const held = await run(layer, section);

        expect(ran.section).toBe(true);
        expect(held).toEqual({
          accountId: account.accountId,
          email: account.email,
        });
        expect(reads.session).toBe(0);
      });

      test("present rejects an account without a login row as unauthenticated", async () => {
        await expectRejected(
          makeSections(null).layer,
          unknownAccountId(),
          "present",
          unauthenticated
        );
      });
    });

    describe("failures", () => {
      test("the lock's own SqlError fails unavailable with the account-link.lock cause", async () => {
        const account = await seedAccount();
        const unreachable = await connectUnreachableWorkspaceDatabase();
        try {
          const { layer } = makeSections(null, unreachable.advisoryLock);
          let ran = false;

          const failure = await failureOf(
            layer,
            Effect.flatMap(sections, ({ withActiveAccount }) =>
              withActiveAccount(
                account.accountId,
                Effect.sync(() => {
                  ran = true;
                }),
                { recheck: "active" }
              )
            )
          );

          expect(failure).toBeInstanceOf(CustomerAccountAccessError);
          expect(failure.reason).toBe("unavailable");
          expect(failure.cause?.code).toBe("account-link.lock");
          expect(ran).toBe(false);
        } finally {
          await unreachable.pool.end();
        }
      });

      test("a section's own SqlError passes through unchanged", async () => {
        const account = await seedAccount();
        const { layer } = makeSections(null);
        const sectionError = new SqlError.SqlError({
          reason: new SqlError.ConnectionError({
            cause: new Error("section statement failed"),
            message: "section statement failed",
            operation: "connect",
          }),
        });

        const failure = await failureOf(
          layer,
          Effect.flatMap(sections, ({ withActiveAccount }) =>
            withActiveAccount(account.accountId, Effect.fail(sectionError), {
              recheck: "active",
            })
          )
        );

        expect(failure).toBe(sectionError);
        expect(await freeElsewhereNow(account.accountId)).toBe(true);
      });

      test("a failing query in the section fails with the query's own error", async () => {
        const account = await seedAccount();
        const { layer } = makeSections(null);
        const failingQuery = suiteDatabase.db.execute(
          sql`select * from customer_account_sections_missing_table`
        );
        const outside = await Effect.runPromise(Effect.flip(failingQuery));

        const inside = await failureOf(
          layer,
          Effect.flatMap(sections, ({ withActiveAccount }) =>
            withActiveAccount(account.accountId, failingQuery, {
              recheck: "active",
            })
          )
        );

        expect(inside).not.toBeInstanceOf(CustomerAccountAccessError);
        expect(inside._tag).toBe(outside._tag);
        expect(await freeElsewhereNow(account.accountId)).toBe(true);
      });
    });

    describe("withOptionalAccount", () => {
      /** Runs an optional section that reports what it was given. */
      const optionalSection = () => {
        const ran = { section: false };
        const section = Effect.flatMap(sections, ({ withOptionalAccount }) =>
          withOptionalAccount((accountId) =>
            Effect.gen(function* () {
              ran.section = true;
              return {
                accountId,
                held: yield* Effect.serviceOption(HeldCustomerAccount),
                free:
                  accountId === null ? null : yield* freeElsewhere(accountId),
              };
            })
          )
        );
        return { ran, section };
      };

      test("an anonymous session runs the section unlocked with no account", async () => {
        const { layer, reads } = makeSections(null);
        const { section } = optionalSection();

        const outcome = await run(layer, section);

        expect(outcome.accountId).toBeNull();
        expect(Option.isNone(outcome.held)).toBe(true);
        expect(reads.session).toBe(1);
      });

      test("unconfigured authentication runs the section unlocked with no account", async () => {
        const { layer } = makeSections(
          new CustomerAccountAccessError({ reason: "not-configured" })
        );
        const { section } = optionalSection();

        const outcome = await run(layer, section);

        expect(outcome.accountId).toBeNull();
        expect(Option.isNone(outcome.held)).toBe(true);
      });

      test("any other session failure fails closed before the section runs", async () => {
        const { layer } = makeSections(
          new CustomerAccountAccessError({ reason: "unavailable" })
        );
        const { ran, section } = optionalSection();

        const failure = await failureOf(layer, section);

        expect(failure.reason).toBe("unavailable");
        expect(ran.section).toBe(false);
      });

      test("a signed-in session runs the section held for its account after one session read", async () => {
        const account = await seedAccount();
        const { layer, reads } = makeSections(sessionFor(account));
        const { section } = optionalSection();

        const outcome = await run(layer, section);

        expect(outcome.accountId).toBe(account.accountId);
        expect(outcome.held).toEqual(
          Option.some({ accountId: account.accountId, email: account.email })
        );
        expect(outcome.free).toBe(false);
        expect(reads.session).toBe(1);
        expect(await freeElsewhereNow(account.accountId)).toBe(true);
      });

      test("a signed-in account awaiting deletion is rejected before the section runs", async () => {
        const account = await seedAccount({ deletionRequested: true });
        const { layer } = makeSections(sessionFor(account));
        const { ran, section } = optionalSection();

        const failure = await failureOf(layer, section);

        expect({
          reason: failure.reason,
          linkReason: failure.linkReason,
        }).toEqual({
          reason: "link-required",
          linkReason: "deletion-requested",
        });
        expect(ran.section).toBe(false);
      });
    });
  }
);
