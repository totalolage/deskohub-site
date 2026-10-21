import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { customerAccounts } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { E2EDatabase } from "../integrations/database.service";
import { removeSyntheticAuthUser } from "./auth-rows";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const insertAuthUser = async (id: string) => {
  await testDatabase!.pool.query(
    "insert into customer_accounts (id) values ($1) on conflict do nothing",
    [id]
  );
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [id, testEmailAddress(`auth-rows-${id}`)]
  );
};

const removeAccount = (accountId: string) =>
  removeSyntheticAuthUser(accountId).pipe(
    Effect.provideService(
      E2EDatabase,
      E2EDatabase.of({ db: testDatabase!.db })
    ),
    Effect.runPromise
  );

/** The tombstone's deletion instant, null while active, undefined when absent. */
const readDeletedAt = async (accountId: string) => {
  const [row] = await testDatabase!.db
    .select({ deletedAt: customerAccounts.deletedAt })
    .from(customerAccounts)
    .where(eq(customerAccounts.id, accountId))
    .pipe(Effect.runPromise);
  return row === undefined ? undefined : (row.deletedAt?.toString() ?? null);
};

const authUserExists = async (accountId: string) => {
  const rows = await testDatabase!.db
    .select({ id: authUser.id })
    .from(authUser)
    .where(eq(authUser.id, accountId))
    .pipe(Effect.runPromise);
  return rows.length > 0;
};

describe.skipIf(!testDatabase)(
  "Synthetic account removal on disposable Postgres",
  () => {
    test("tombstones the customer account and deletes the Better Auth user", async () => {
      const accountId = `agent-eval-${crypto.randomUUID()}`;
      await insertAuthUser(accountId);
      expect(await readDeletedAt(accountId)).toBeNull();

      await removeAccount(accountId);

      expect(await readDeletedAt(accountId)).toEqual(expect.any(String));
      expect(await authUserExists(accountId)).toBe(false);
    });

    test("leaves a tombstone for an unlinked account", async () => {
      const accountId = crypto.randomUUID();
      await insertAuthUser(accountId);

      await removeAccount(accountId);

      expect(await readDeletedAt(accountId)).toEqual(expect.any(String));
      expect(await authUserExists(accountId)).toBe(false);
    });

    test("keeps the first deletion instant when cleanup repeats", async () => {
      const accountId = crypto.randomUUID();
      await insertAuthUser(accountId);
      await removeAccount(accountId);
      const firstDeletedAt = await readDeletedAt(accountId);

      await removeAccount(accountId);

      expect(await readDeletedAt(accountId)).toBe(firstDeletedAt);
    });
  }
);
