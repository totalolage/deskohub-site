import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { type AuthDatabase, makeAuthDatabase } from "./auth-database-client";
import { makeDatabasePool } from "./database-client";
import { authAccount, authSession, authUser } from "./schema/auth";
import { customerAccountLinks } from "./schema/customer-account-links";
import { customerAccounts } from "./schema/customer-accounts";

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

const insertAuthUser = async (
  database: AuthDatabase,
  id: string,
  email: string
) => {
  await database.insert(customerAccounts).values({ id }).onConflictDoNothing();
  return database
    .insert(authUser)
    .values({ id, name: "", email })
    .returning({ id: authUser.id, createdAt: authUser.createdAt });
};

describe.skipIf(!postgresDatabase)(
  "Better Auth persistence over the shared pool",
  () => {
    let pool: Pool;
    let db: AuthDatabase;

    beforeAll(() => {
      pool = makeDatabasePool({
        connectionString: process.env.WORKSPACE_TEST_DATABASE_URL!,
      });
      db = makeAuthDatabase(pool);
    });

    afterAll(async () => {
      await pool.end();
    });

    test("decodes timestamps as Date through the shared-pool facade", async () => {
      const instant = new Date("2026-09-03T10:30:00.123Z");
      const rawEmail = testEmailAddress(`raw-${uniqueId()}`);
      const rawUserId = uniqueId();
      await pool.query(
        "insert into customer_accounts (id) values ($1) on conflict do nothing",
        [rawUserId]
      );
      await pool.query(
        `INSERT INTO auth."user" (id, name, email, created_at) VALUES ($1, '', $2, $3)`,
        [rawUserId, rawEmail, instant]
      );

      const inserted = await insertAuthUser(
        db,
        uniqueId(),
        testEmailAddress(`facade-${uniqueId()}`)
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
        testEmailAddress(`link-a-${uniqueId()}`)
      );
      await insertAuthUser(
        db,
        secondUserId,
        testEmailAddress(`link-b-${uniqueId()}`)
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
      await insertAuthUser(
        db,
        userId,
        testEmailAddress(`cascade-${uniqueId()}`)
      );
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

    test("resolves user→sessions/accounts joins through the auth-only graph", async () => {
      const userId = uniqueId();
      await insertAuthUser(db, userId, testEmailAddress(`graph-${uniqueId()}`));
      await db.insert(authSession).values({
        id: uniqueId(),
        expiresAt: new Date(Date.now() + 3_600_000),
        token: `token-${uniqueId()}`,
        userId,
      });
      await db.insert(authAccount).values({
        id: uniqueId(),
        issuer: "deskohub.test",
        accountId: `provider-${uniqueId()}`,
        providerId: "credential",
        userId,
      });

      const [row] = await db.query.user.findMany({
        // Relations-v2 filters are objects; a v1-style callback is silently
        // dropped by relationsFilterToSQL (Object.entries on a function).
        where: { id: userId },
        with: { sessions: true, accounts: true },
      });

      expect(row).toBeDefined();
      expect(Array.isArray(row!.sessions)).toBe(true);
      expect(row!.sessions).toHaveLength(1);
      expect(Array.isArray(row!.accounts)).toBe(true);
      expect(row!.accounts).toHaveLength(1);
    });
  }
);
