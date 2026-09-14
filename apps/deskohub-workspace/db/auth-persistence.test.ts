import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Effect } from "effect";
import { Pool } from "pg";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  makeDatabaseClient,
  makeDatabasePool,
  makeNodePostgresDatabase,
} from "./database-client";
import { workspaceDatabasePool } from "./database-provider.server";
import { authUser } from "./schema/auth";
import { customerAccountLinks } from "./schema/customer-account-links";

const postgresDatabase: WorkspacePostgresTestDatabase | null =
  await connectWorkspacePostgresTestDatabase();

const uniqueId = () => crypto.randomUUID();

const pgErrorCode = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (cause: unknown) => cause
  );
  for (
    let current: unknown = error;
    current;
    current = (current as { cause?: unknown }).cause
  ) {
    if ("code" in current) return String((current as { code: unknown }).code);
  }
  return undefined;
};

const insertAuthUser = (database: NodePgDatabase, id: string, email: string) =>
  database
    .insert(authUser)
    .values({ id, name: "", email })
    .returning({ id: authUser.id, createdAt: authUser.createdAt });

describe.skipIf(!postgresDatabase)(
  "Better Auth persistence over the shared pool",
  () => {
    let pool: Pool;
    let db: NodePgDatabase;

    beforeAll(() => {
      pool = makeDatabasePool({
        connectionString: process.env.WORKSPACE_TEST_DATABASE_URL!,
      });
      db = makeNodePostgresDatabase(pool);
    });

    afterAll(async () => {
      await pool.end();
    });

    test("applies the complete migration chain from an empty database", () => {
      expect(postgresDatabase).not.toBeNull();
    });

    test("decodes timestamps as Date through the shared-pool facade", async () => {
      const instant = new Date("2026-09-03T10:30:00.123Z");
      const rawEmail = `raw-${uniqueId()}@deskohub.test`;
      await pool.query(
        `INSERT INTO auth."user" (id, name, email, created_at) VALUES ($1, '', $2, $3)`,
        [uniqueId(), rawEmail, instant]
      );

      const inserted = await insertAuthUser(
        db,
        uniqueId(),
        `facade-${uniqueId()}@deskohub.test`
      );

      const [rawRow] = await db
        .select()
        .from(authUser)
        .where(sql`${authUser.email} = ${rawEmail}`);

      expect(rawRow).toBeDefined();
      expect(rawRow!.createdAt).toBeInstanceOf(Date);
      expect(rawRow!.createdAt.toISOString()).toBe(instant.toISOString());
      expect(inserted[0]!.createdAt).toBeInstanceOf(Date);
    });

    test("keeps one link per Dotypos customer and rejects blank customer IDs", async () => {
      const firstUserId = uniqueId();
      const secondUserId = uniqueId();
      const dotyposCustomerId = `60${Math.floor(Math.random() * 1_000_000)}`;

      await insertAuthUser(
        db,
        firstUserId,
        `link-a-${uniqueId()}@deskohub.test`
      );
      await insertAuthUser(
        db,
        secondUserId,
        `link-b-${uniqueId()}@deskohub.test`
      );
      await db
        .insert(customerAccountLinks)
        .values({ customerAccountId: firstUserId, dotyposCustomerId });

      const duplicate = await pgErrorCode(
        db
          .insert(customerAccountLinks)
          .values({ customerAccountId: secondUserId, dotyposCustomerId })
      );

      expect(duplicate).toBe("23505");

      const blank = await pgErrorCode(
        db
          .insert(customerAccountLinks)
          .values({ customerAccountId: secondUserId, dotyposCustomerId: "   " })
      );

      expect(blank).toBe("23514");
    });

    test("cascades link removal from the auth user and enforces the foreign key", async () => {
      const userId = uniqueId();
      await insertAuthUser(db, userId, `cascade-${uniqueId()}@deskohub.test`);
      await db.insert(customerAccountLinks).values({
        customerAccountId: userId,
        dotyposCustomerId: `61${Math.floor(Math.random() * 1_000_000)}`,
      });

      const orphan = await pgErrorCode(
        db.insert(customerAccountLinks).values({
          customerAccountId: uniqueId(),
          dotyposCustomerId: `62${Math.floor(Math.random() * 1_000_000)}`,
        })
      );
      expect(orphan).toBe("23503");

      await db.delete(authUser).where(sql`${authUser.id} = ${userId}`);

      const remaining = await db
        .select()
        .from(customerAccountLinks)
        .where(sql`${customerAccountLinks.customerAccountId} = ${userId}`);
      expect(remaining).toHaveLength(0);
    });

    test("rolls back auth and link writes together", async () => {
      const userId = uniqueId();
      const before = await db.select({ id: authUser.id }).from(authUser);

      await db
        .transaction(async (tx) => {
          await tx.insert(authUser).values({
            id: userId,
            name: "",
            email: `rollback-${uniqueId()}@deskohub.test`,
          });
          await tx.insert(customerAccountLinks).values({
            customerAccountId: userId,
            dotyposCustomerId: `63${Math.floor(Math.random() * 1_000_000)}`,
          });
          throw new Error("force rollback");
        })
        .catch(() => {});

      const after = await db.select({ id: authUser.id }).from(authUser);
      expect(after).toHaveLength(before.length);
      expect(after.some((row) => row.id === userId)).toBe(false);
    });

    test("feeds both Drizzle facades from one underlying pool", async () => {
      expect(workspaceDatabasePool).toBeInstanceOf(Pool);
      expect(makeNodePostgresDatabase(workspaceDatabasePool).$client).toBe(
        workspaceDatabasePool
      );

      const originalConnect = workspaceDatabasePool.connect.bind(
        workspaceDatabasePool
      );
      let acquired = 0;
      workspaceDatabasePool.connect = function spiedConnect(...args: never[]) {
        acquired += 1;
        return originalConnect(...(args as Parameters<Pool["connect"]>));
      } as Pool["connect"];

      try {
        const effectDb = await Effect.runPromise(
          Effect.flatMap(
            makeDatabaseClient(workspaceDatabasePool),
            (database) => database.execute(sql`select 1 as acquired`)
          )
        );
        expect(effectDb.rows).toEqual([{ acquired: 1 }]);

        const nodeDb = await makeNodePostgresDatabase(
          workspaceDatabasePool
        ).execute(sql`select 1 as acquired`);
        expect(nodeDb.rows).toEqual([{ acquired: 1 }]);
      } finally {
        workspaceDatabasePool.connect = originalConnect;
      }

      expect(acquired).toBeGreaterThanOrEqual(2);
    });
  }
);
