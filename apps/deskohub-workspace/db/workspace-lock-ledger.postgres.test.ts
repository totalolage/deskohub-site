import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { WorkspaceDatabase } from "./database.service";
import { makeDatabaseClient } from "./database-client";
import {
  type TransactionLockRequest,
  takeTransactionLock,
} from "./workspace-lock-ledger";

const suiteDatabase = await createWorkspacePostgresSuiteDatabase(
  "workspace_lock_ledger"
);
const db =
  suiteDatabase &&
  (await Effect.runPromise(makeDatabaseClient(suiteDatabase.pool)));

describe.skipIf(!suiteDatabase)(
  "Workspace lock ledger key order on disposable Postgres",
  () => {
    if (!suiteDatabase || !db) return;
    const { transaction } = WorkspaceDatabase.make(db);

    afterAll(() => suiteDatabase.close());

    const outOfRankOrder = (exit: Exit.Exit<unknown, unknown>) =>
      Exit.isFailure(exit) &&
      Cause.hasDies(exit.cause) &&
      Cause.pretty(exit.cause).includes("out of rank order");

    /** Two keys of each form, each pair in ascending order. */
    const keys = () => {
      const unique = crypto.randomUUID();
      const bigint = BigInt(Math.floor(Math.random() * 1e12));
      return {
        pair: [
          { pair: ["ledger-test", `${unique}-a`] },
          { pair: ["ledger-test", `${unique}-b`] },
        ],
        bigint: [{ bigint }, { bigint: bigint + 1n }],
        hashed: [{ hashed: `${unique}-a` }, { hashed: `${unique}-b` }],
      } as const;
    };

    const takeInOneRank = (
      first: TransactionLockRequest,
      second: TransactionLockRequest
    ) =>
      Effect.runPromiseExit(
        transaction(
          takeTransactionLock(first).pipe(
            Effect.andThen(takeTransactionLock(second))
          )
        )
      );

    for (const form of ["pair", "bigint", "hashed"] as const) {
      test(`${form} keys of one rank are taken in ascending key order`, async () => {
        const [lower, higher] = keys()[form];
        const lock = (key: typeof lower) => ({ ...key, name: form, rank: 1 });

        const ascending = await takeInOneRank(lock(lower), lock(higher));
        const descending = await takeInOneRank(lock(higher), lock(lower));

        expect(Exit.isSuccess(ascending)).toBe(true);
        expect(outOfRankOrder(descending)).toBe(true);
      });
    }

    test("a held key of one form is not mistaken for a key of another form", async () => {
      const { pair, bigint, hashed } = keys();
      const exit = await Effect.runPromiseExit(
        transaction(
          Effect.all([
            takeTransactionLock({ ...pair[0], name: "pair", rank: 1 }),
            takeTransactionLock({ ...bigint[0], name: "bigint", rank: 2 }),
            takeTransactionLock({ ...hashed[0], name: "hashed", rank: 3 }),
            // A re-take of a held key is recognised even among other forms,
            // so it reports no order violation despite the higher ranks held.
            takeTransactionLock({ ...pair[0], name: "pair", rank: 1 }),
            takeTransactionLock({ ...bigint[0], name: "bigint", rank: 2 }),
          ])
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  }
);
