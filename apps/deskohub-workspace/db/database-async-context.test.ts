import { describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { makeDatabaseClient, makeDatabasePool } from "./database-client";
import { databasePoolTimeouts } from "./database-pool-timeouts";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

// Stands in for the Next.js request stores that revalidatePath, headers() and
// after() read: pg fires query callbacks from the socket of whichever request
// opened the pooled connection, so a statement must not resume its Effect in
// that request's store.
const requestStore = new AsyncLocalStorage<string>();

describe.skipIf(!postgresDatabase)(
  "Database statements against real Postgres",
  () => {
    test("resume in the async context of the request that issued them", async () => {
      const pool = makeDatabasePool({
        connectionString: process.env.WORKSPACE_TEST_DATABASE_URL ?? "",
        ...databasePoolTimeouts,
        max: 1,
      });
      try {
        const db = await Effect.runPromise(makeDatabaseClient(pool));
        const runRequest = (request: string) =>
          requestStore.run(request, () =>
            Effect.runPromise(
              db
                .execute(sql`select pg_sleep(0.05)`)
                .pipe(Effect.map(() => requestStore.getStore()))
            )
          );

        expect(await runRequest("connection-opener")).toBe("connection-opener");
        expect(await runRequest("connection-reuser")).toBe("connection-reuser");
        expect(
          await Promise.all([
            runRequest("connection-holder"),
            runRequest("connection-waiter"),
          ])
        ).toEqual(["connection-holder", "connection-waiter"]);
      } finally {
        await pool.end();
      }
    });
  }
);
