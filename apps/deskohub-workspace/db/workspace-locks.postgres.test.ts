import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import {
  Cause,
  Duration,
  Effect,
  Exit,
  Logger,
  Predicate,
  References,
} from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  WorkspaceDatabase,
  type WorkspaceTransaction,
} from "./database.service";
import { makeDatabaseClient, makeDatabasePool } from "./database-client";
import { WorkspaceDatabaseAdvisoryLock } from "./postgres-advisory-lock";
import { isLockWaitTimeout } from "./sql-constraint";
import { WorkspaceLockSections, WorkspaceLocks } from "./workspace-locks";

test("bun test runs with NODE_ENV=test, so lock violations die here", () => {
  expect(process.env.NODE_ENV).toBe("test");
});

const suiteDatabase =
  await createWorkspacePostgresSuiteDatabase("workspace_locks");

// Records the lock and lock_timeout statements the registry sends.
const recorded: Array<{
  readonly text: string;
  readonly values: ReadonlyArray<unknown>;
}> = [];
const recordingPool =
  suiteDatabase &&
  makeDatabasePool({
    connectionString: suiteDatabase.pool.options.connectionString!,
    max: 6,
  });
recordingPool?.on("connect", (client) => {
  const query = client.query.bind(client) as (
    ...args: Array<unknown>
  ) => unknown;
  Object.assign(client, {
    query: (...args: Array<unknown>) => {
      const [text, values] = args;
      if (
        Predicate.isString(text) &&
        /pg_advisory_xact_lock|lock_timeout/.test(text)
      ) {
        recorded.push({ text, values: Array.isArray(values) ? values : [] });
      }
      return query(...args);
    },
  });
});
const db =
  recordingPool && (await Effect.runPromise(makeDatabaseClient(recordingPool)));
describe.skipIf(!suiteDatabase)(
  "Workspace locks on disposable Postgres",
  () => {
    if (!suiteDatabase || !recordingPool || !db) return;
    const { pool } = suiteDatabase;
    const { transaction } = WorkspaceDatabase.make(db);

    const advisoryLock = WorkspaceDatabaseAdvisoryLock.makeLayer(recordingPool);

    afterAll(async () => {
      await recordingPool.end();
      await suiteDatabase.close();
    });

    const run = <A, E>(
      effect: Effect.Effect<A, E, WorkspaceDatabaseAdvisoryLock>
    ) => Effect.runPromiseExit(effect.pipe(Effect.provide(advisoryLock)));

    /** A defect from the guard whose message contains `fragment`. */
    const dies = (exit: Exit.Exit<unknown, unknown>, fragment: string) =>
      Exit.isFailure(exit) &&
      Cause.hasDies(exit.cause) &&
      Cause.pretty(exit.cause).includes(fragment);

    type Probe = readonly [text: string, values: ReadonlyArray<unknown>];

    /** Whether another session can take the key now; it releases it at once. */
    const freeElsewhereNow = async ([text, values]: Probe) => {
      const other = await pool.connect();
      try {
        const { rows } = await other.query<{ free: boolean }>(
          `select ${text} as free`,
          [...values]
        );
        return rows[0]!.free;
      } finally {
        other.release();
      }
    };
    const freeElsewhere = (probe: Probe) =>
      Effect.promise(() => freeElsewhereNow(probe));

    /** Today's literal SQL for a two-part key, as a try-lock. */
    const pairProbe = (namespace: string, key: string): Probe => [
      `pg_try_advisory_xact_lock(hashtext('${namespace}'), hashtext($1))`,
      [key],
    ];
    const accountProbe = (accountId: string) =>
      pairProbe("customer-account", accountId);
    const graphProbe: Probe = [
      "pg_try_advisory_xact_lock(hashtext('referral-attribution'), hashtext('graph'))",
      [],
    ];

    const accountId = () =>
      `account-${crypto.randomUUID()}` as CustomerAccountId;
    /** Two account IDs in ascending order. */
    const accountPair = () => {
      const [first, second] = [accountId(), accountId()].sort();
      return [first!, second!] as const;
    };

    const lockTimeout = Effect.map(
      db.execute<{ lock_timeout: string }>(
        sql`select current_setting('lock_timeout') as lock_timeout`
      ),
      ({ rows }) => rows[0]!.lock_timeout
    );

    describe("every operation locks today's key", () => {
      const id = crypto.randomUUID();
      const checkoutKey = 8_412_345_678_901n;
      const operations: ReadonlyArray<
        readonly [
          name: string,
          take: Effect.Effect<void, unknown, WorkspaceTransaction>,
          probe: Probe,
        ]
      > = [
        ["referralGraph", WorkspaceLocks.referralGraph(), graphProbe],
        [
          "customerAccount",
          WorkspaceLocks.customerAccount(`account-${id}` as CustomerAccountId),
          accountProbe(`account-${id}`),
        ],
        [
          "referralFirstBooking",
          WorkspaceLocks.referralFirstBooking(
            `customer-${id}` as DotyposCustomerId
          ),
          pairProbe("referral-first-booking", `customer-${id}`),
        ],
        [
          "checkoutSession",
          WorkspaceLocks.checkoutSession(checkoutKey),
          ["pg_try_advisory_xact_lock($1::bigint)", [checkoutKey.toString()]],
        ],
        [
          "manualInvoiceCreation",
          WorkspaceLocks.manualInvoiceCreation(`invoice-${id}`),
          pairProbe("manual-invoice-creation", `invoice-${id}`),
        ],
        [
          "manualInvoiceNewCustomer",
          WorkspaceLocks.manualInvoiceNewCustomer(),
          [
            "pg_try_advisory_xact_lock(hashtext('manual-invoice-new-customer'), hashtext('global'))",
            [],
          ],
        ],
        [
          "manualInvoiceIssue",
          WorkspaceLocks.manualInvoiceIssue(`invoice-${id}`),
          ["pg_try_advisory_xact_lock(hashtext($1))", [`invoice-${id}`]],
        ],
        [
          "automationFireEntry",
          WorkspaceLocks.automationFireEntry(`campaign-${id}`),
          pairProbe("email-automation-fire-entry", `campaign-${id}`),
        ],
        [
          "requestBudget",
          WorkspaceLocks.requestBudget(`policy-${id}`),
          pairProbe("request-budget", `policy-${id}`),
        ],
        [
          "standaloneAccessCodeDevice",
          WorkspaceLocks.standaloneAccessCodeDevice(`device-${id}`),
          pairProbe("standalone-access-code", `device-${id}`),
        ],
        [
          "legacyAdministrator",
          WorkspaceLocks.legacyAdministrator(`admin-${id}`),
          pairProbe("legacy-administrator", `admin-${id}`),
        ],
        [
          "automationUnitSlots",
          WorkspaceLocks.automationUnitSlots(),
          [
            "pg_try_advisory_xact_lock(hashtext('email-automation-unit-slots'), hashtext('engine'))",
            [],
          ],
        ],
      ];

      for (const [name, take, probe] of operations) {
        test(name, async () => {
          const exit = await run(
            transaction(Effect.andThen(take, freeElsewhere(probe)))
          );
          expect(exit).toStrictEqual(Exit.succeed(false));
          expect(await freeElsewhereNow(probe)).toBe(true);
        });
      }

      test("signInEmail section", async () => {
        const digest = `digest-${id}`;
        const probe = pairProbe("sign-in-email", digest);
        const exit = await run(
          WorkspaceLockSections.signInEmail(digest)(freeElsewhere(probe))
        );
        expect(exit).toStrictEqual(Exit.succeed(false));
        expect(await freeElsewhereNow(probe)).toBe(true);
      });

      test("customerAccount section", async () => {
        const account = accountId();
        const probe = accountProbe(account);
        const exit = await run(
          WorkspaceLockSections.customerAccount(account)(freeElsewhere(probe))
        );
        expect(exit).toStrictEqual(Exit.succeed(false));
        expect(await freeElsewhereNow(probe)).toBe(true);
      });
    });

    test("customerAccounts takes each account once, in ascending ID order", async () => {
      const [first, second] = accountPair();
      recorded.length = 0;
      const exit = await run(
        transaction(
          WorkspaceLocks.customerAccounts([second, first, second]).pipe(
            Effect.andThen(
              Effect.all([
                freeElsewhere(accountProbe(first)),
                freeElsewhere(accountProbe(second)),
              ])
            )
          )
        )
      );
      expect(exit).toStrictEqual(Exit.succeed([false, false]));
      expect(recorded.map(({ values }) => values)).toEqual([
        ["customer-account", first],
        ["customer-account", second],
      ]);
    });

    test("a lower rank after a higher one dies under bun test", async () => {
      const exit = await run(
        transaction(
          WorkspaceLocks.customerAccount(accountId()).pipe(
            Effect.andThen(WorkspaceLocks.referralGraph())
          )
        )
      );
      expect(dies(exit, "out of rank order")).toBe(true);
      const [first, second] = accountPair();
      const descending = await run(
        transaction(
          WorkspaceLocks.customerAccount(second).pipe(
            Effect.andThen(WorkspaceLocks.customerAccount(first))
          )
        )
      );
      expect(dies(descending, "out of rank order")).toBe(true);
    });

    test("a held key is taken again without a report, and the statement runs again", async () => {
      const account = accountId();
      recorded.length = 0;
      const exit = await run(
        transaction(
          Effect.all([
            WorkspaceLocks.customerAccount(account),
            WorkspaceLocks.referralFirstBooking(
              `customer-${account}` as DotyposCustomerId
            ),
            WorkspaceLocks.customerAccount(account),
          ])
        )
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(recorded).toHaveLength(3);
    });

    test("a rolled-back savepoint drops its locks from the ledger; a re-take runs and holds", async () => {
      const account = accountId();
      const exit = await run(
        transaction(
          Effect.gen(function* () {
            yield* transaction(
              WorkspaceLocks.customerAccount(account).pipe(
                Effect.andThen(Effect.fail("roll back" as const))
              )
            ).pipe(Effect.ignore);
            const releasedByPostgres = yield* freeElsewhere(
              accountProbe(account)
            );
            // In rank order only if the ledger forgot the account lock.
            yield* WorkspaceLocks.referralGraph();
            yield* WorkspaceLocks.customerAccount(account);
            return [
              releasedByPostgres,
              yield* freeElsewhere(accountProbe(account)),
            ];
          })
        )
      );
      expect(exit).toStrictEqual(Exit.succeed([true, false]));
    });

    test("a successful savepoint keeps its locks in the ledger", async () => {
      const exit = await run(
        transaction(
          transaction(WorkspaceLocks.customerAccount(accountId())).pipe(
            Effect.andThen(WorkspaceLocks.referralGraph())
          )
        )
      );
      expect(dies(exit, "out of rank order")).toBe(true);
    });

    test("the ledger ends with its root transaction", async () => {
      const exit = await run(
        transaction(WorkspaceLocks.customerAccount(accountId())).pipe(
          Effect.andThen(transaction(WorkspaceLocks.referralGraph()))
        )
      );
      expect(Exit.isSuccess(exit)).toBe(true);
    });

    test("an interrupted savepoint drops its locks from the ledger and Postgres", async () => {
      const account = accountId();
      const exit = await run(
        transaction(
          Effect.gen(function* () {
            yield* transaction(
              WorkspaceLocks.customerAccount(account).pipe(
                Effect.andThen(Effect.never)
              )
            ).pipe(Effect.timeout("100 millis"), Effect.ignore);
            const releasedByPostgres = yield* freeElsewhere(
              accountProbe(account)
            );
            // In rank order only if the ledger forgot the account lock.
            yield* WorkspaceLocks.referralGraph();
            return releasedByPostgres;
          })
        )
      );
      expect(exit).toStrictEqual(Exit.succeed(true));
    });

    test("an in-order bounded wait runs in a savepoint and restores lock_timeout", async () => {
      recorded.length = 0;
      const exit = await run(
        transaction(
          Effect.gen(function* () {
            yield* db.execute(sql`set local lock_timeout = '7s'`);
            yield* WorkspaceLocks.referralGraph({
              boundedWait: Duration.seconds(5),
            });
            return [yield* lockTimeout, yield* freeElsewhere(graphProbe)];
          })
        )
      );
      expect(exit).toStrictEqual(Exit.succeed(["7s", false]));
      expect(recorded.flatMap(({ values }) => values)).toContain("5000ms");
    });

    test("an in-order bounded wait under contention fails with a lock timeout and restores lock_timeout", async () => {
      const holder = await pool.connect();
      try {
        await holder.query("begin");
        await holder.query(
          "select pg_advisory_xact_lock(hashtext('referral-attribution'), hashtext('graph'))"
        );
        recorded.length = 0;
        const exit = await run(
          transaction(
            Effect.gen(function* () {
              yield* db.execute(sql`set local lock_timeout = '7s'`);
              const error = yield* Effect.flip(
                WorkspaceLocks.referralGraph({
                  boundedWait: Duration.millis(200),
                })
              );
              return [isLockWaitTimeout(error), yield* lockTimeout];
            })
          ).pipe(Effect.timeout("20 seconds"))
        );
        expect(exit).toStrictEqual(Exit.succeed([true, "7s"]));
        expect(recorded.flatMap(({ values }) => values)).toContain("200ms");
      } finally {
        await holder.query("rollback");
        holder.release();
      }
    });

    test("an out-of-order bounded wait under a section-held higher rank runs in a savepoint and restores lock_timeout", async () => {
      recorded.length = 0;
      const exit = await run(
        WorkspaceLockSections.customerAccount(accountId())(
          transaction(
            Effect.gen(function* () {
              yield* db.execute(sql`set local lock_timeout = '7s'`);
              yield* WorkspaceLocks.referralGraph({
                boundedWait: Duration.seconds(5),
              });
              return [yield* lockTimeout, yield* freeElsewhere(graphProbe)];
            })
          )
        )
      );
      expect(exit).toStrictEqual(Exit.succeed(["7s", false]));
      expect(recorded.flatMap(({ values }) => values)).toContain("5000ms");
    });

    test("an out-of-order bounded wait under a transaction-held higher rank dies under bun test", async () => {
      const exit = await run(
        transaction(
          WorkspaceLocks.customerAccount(accountId()).pipe(
            Effect.andThen(
              WorkspaceLocks.referralGraph({ boundedWait: Duration.seconds(5) })
            )
          )
        )
      );
      expect(dies(exit, "out of rank order")).toBe(true);
    });

    test("a bounded wait that expires fails with a lock timeout, and the transaction continues", async () => {
      const holder = await pool.connect();
      try {
        await holder.query("begin");
        await holder.query(
          "select pg_advisory_xact_lock(hashtext('referral-attribution'), hashtext('graph'))"
        );
        recorded.length = 0;
        const exit = await run(
          WorkspaceLockSections.customerAccount(accountId())(
            transaction(
              Effect.gen(function* () {
                const error = yield* Effect.flip(
                  WorkspaceLocks.referralGraph({ boundedWait: 0.4 })
                );
                return [isLockWaitTimeout(error), yield* lockTimeout];
              })
            )
          ).pipe(Effect.timeout("20 seconds"))
        );
        expect(exit).toStrictEqual(Exit.succeed([true, "0"]));
        // 0.4 ms rounds up to whole milliseconds; 0 would disable the timeout.
        expect(recorded.flatMap(({ values }) => values)).toContain("1ms");
      } finally {
        await holder.query("rollback");
        holder.release();
      }
    });

    for (const boundedWait of [0, -5, Number.POSITIVE_INFINITY] as const) {
      test(`a bounded wait of ${boundedWait} ms dies`, async () => {
        const exit = await run(
          transaction(WorkspaceLocks.referralGraph({ boundedWait }))
        );
        expect(dies(exit, "positive, finite")).toBe(true);
      });
    }

    test("a key an enclosing section holds dies at once instead of waiting on the section", async () => {
      const account = accountId();
      const exit = await run(
        WorkspaceLockSections.customerAccount(account)(
          transaction(WorkspaceLocks.customerAccount(account))
        ).pipe(Effect.timeout("20 seconds"))
      );
      expect(dies(exit, "enclosing lock section")).toBe(true);
    });

    test("a section entered inside a transaction dies under bun test", async () => {
      const exit = await run(
        transaction(
          WorkspaceLockSections.customerAccount(accountId())(Effect.void)
        )
      );
      expect(dies(exit, "inside a Workspace transaction")).toBe(true);
    });

    describe("with NODE_ENV=production", () => {
      const inProduction = async <A, E>(
        effect: Effect.Effect<A, E, WorkspaceDatabaseAdvisoryLock>
      ) => {
        const logs: Array<{
          readonly level: string;
          readonly annotations: unknown;
        }> = [];
        // Errors only: the database client logs its queries at Info.
        const capture = Logger.make((options) => {
          if (options.logLevel !== "Error") return;
          logs.push({
            level: options.logLevel,
            annotations: options.fiber.getRef(References.CurrentLogAnnotations),
          });
        });
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        try {
          const exit = await run(
            effect.pipe(Effect.provide(Logger.layer([capture])))
          );
          return { exit, logs };
        } finally {
          process.env.NODE_ENV = previous;
        }
      };

      test("an out-of-order lock is logged without its key and then taken", async () => {
        const account = accountId();
        const { exit, logs } = await inProduction(
          transaction(
            WorkspaceLocks.customerAccount(account).pipe(
              Effect.andThen(WorkspaceLocks.referralGraph()),
              Effect.andThen(freeElsewhere(graphProbe))
            )
          )
        );
        expect(exit).toStrictEqual(Exit.succeed(false));
        expect(logs).toEqual([
          {
            level: "Error",
            annotations: {
              code: "workspace-lock-order",
              requested: "referralGraph",
              rank: 10,
              heldAbove: ["customerAccount"],
            },
          },
        ]);
        expect(JSON.stringify(logs)).not.toContain(account);
      });

      test("a section entered inside a transaction is logged and then held", async () => {
        const account = accountId();
        const { exit, logs } = await inProduction(
          transaction(
            WorkspaceLocks.referralGraph().pipe(
              Effect.andThen(
                WorkspaceLockSections.customerAccount(account)(
                  freeElsewhere(accountProbe(account))
                )
              )
            )
          )
        );
        expect(exit).toStrictEqual(Exit.succeed(false));
        expect(logs).toEqual([
          {
            level: "Error",
            annotations: {
              code: "workspace-lock-section-in-transaction",
              requested: "customerAccount",
              rank: 20,
              heldAbove: ["referralGraph"],
            },
          },
        ]);
        expect(JSON.stringify(logs)).not.toContain(account);
      });

      test("a key an enclosing section holds still dies", async () => {
        const account = accountId();
        const { exit } = await inProduction(
          WorkspaceLockSections.customerAccount(account)(
            transaction(WorkspaceLocks.customerAccount(account))
          ).pipe(Effect.timeout("20 seconds"))
        );
        expect(dies(exit, "enclosing lock section")).toBe(true);
      });
    });
  }
);
