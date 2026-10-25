import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import type { Pool } from "pg";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { type AuthDatabase, makeAuthDatabase } from "./auth-database-client";
import { makeDatabasePool } from "./database-client";
import { authAccount, authSession, authUser } from "./schema/auth";
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

const fixtures = () => workspaceFixtures(postgresDatabase!.db);

const insertAuthUser = (id: string) =>
  Effect.runPromise(
    fixtures().account("auth-persistence", {
      id: customerAccountIdSchema.make(id),
      verified: false,
    })
  );

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
      await Effect.runPromise(
        fixtures().account("raw", {
          id: customerAccountIdSchema.make(rawUserId),
          email: rawEmail,
          createdAt: Temporal.Instant.fromEpochMilliseconds(instant.getTime()),
        })
      );

      const facadeUserId = uniqueId();
      await Effect.runPromise(
        fixtures().customerAccount({
          id: customerAccountIdSchema.make(facadeUserId),
        })
      );
      const inserted = await db
        .insert(authUser)
        .values({
          id: facadeUserId,
          name: "",
          email: testEmailAddress(`facade-${uniqueId()}`),
        })
        .returning({ createdAt: authUser.createdAt });

      const [rawRow] = await db
        .select()
        .from(authUser)
        .where(sql`${authUser.email} = ${rawEmail}`);

      expect(rawRow).toBeDefined();
      expect(rawRow!.createdAt).toBeInstanceOf(Date);
      expect(rawRow!.createdAt.toISOString()).toBe(instant.toISOString());
      expect(inserted[0]!.createdAt).toBeInstanceOf(Date);
    });

    test("keeps one account per Dotypos customer and rejects blank customer IDs", async () => {
      const firstUserId = uniqueId();
      const secondUserId = uniqueId();
      const dotyposCustomerId = `60${Math.floor(Math.random() * 1_000_000)}`;

      await insertAuthUser(firstUserId);
      await insertAuthUser(secondUserId);
      const linkTo = (id: string, customerId: string) =>
        db
          .update(customerAccounts)
          .set({ dotyposCustomerId: customerId as DotyposCustomerId })
          .where(sql`${customerAccounts.id} = ${id}`);
      await linkTo(firstUserId, dotyposCustomerId);

      expect(await pgErrorCode(linkTo(secondUserId, dotyposCustomerId))).toBe(
        "23505"
      );
      expect(await pgErrorCode(linkTo(secondUserId, "   "))).toBe("23514");
    });

    test("roots every login in a customer account that outlives it", async () => {
      const userId = uniqueId();
      await insertAuthUser(userId);

      const accountless = await pgErrorCode(
        db.insert(authUser).values({
          id: uniqueId(),
          name: "",
          email: testEmailAddress(`accountless-${uniqueId()}`),
        })
      );
      expect(accountless).toBe("23503");
      const accountDeletion = await pgErrorCode(
        db
          .delete(customerAccounts)
          .where(sql`${customerAccounts.id} = ${userId}`)
      );
      expect(accountDeletion).toBe("23001");

      await db.delete(authUser).where(sql`${authUser.id} = ${userId}`);

      const remaining = await db
        .select()
        .from(customerAccounts)
        .where(sql`${customerAccounts.id} = ${userId}`);
      expect(remaining).toHaveLength(1);
    });

    test("resolves user→sessions/accounts joins through the auth-only graph", async () => {
      const userId = uniqueId();
      await insertAuthUser(userId);
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
