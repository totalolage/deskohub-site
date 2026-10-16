import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { AccountRoleGrants } from "./account-role-grants.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const runGrants = <A, E>(
  operation: (grants: AccountRoleGrants["Service"]) => Effect.Effect<A, E>
) =>
  Effect.runPromise(
    AccountRoleGrants.pipe(
      Effect.flatMap(operation),
      Effect.provide(
        AccountRoleGrants.Default.pipe(Layer.provide(testDatabase!.layer))
      )
    )
  );

const insertAccount = async () => {
  const accountId = customerAccountIdSchema.make(crypto.randomUUID());
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email, email_verified) values ($1, '', $2, true)`,
    [accountId, testEmailAddress(`role-grant-${accountId}`)]
  );
  return accountId;
};

const deleteAccount = (accountId: string) =>
  testDatabase!.pool.query(`delete from auth."user" where id = $1`, [
    accountId,
  ]);

const role = "administrator" as const;

describe.skipIf(!testDatabase)(
  "AccountRoleGrants on disposable Postgres",
  () => {
    test("grants a role once and keeps the original grant on a repeat", async () => {
      const accountId = await insertAccount();
      const granter = await insertAccount();

      expect(await runGrants((grants) => grants.has({ accountId, role }))).toBe(
        false
      );
      const first = await runGrants((grants) =>
        grants.grant({ accountId, role, grantedBy: granter })
      );
      const repeat = await runGrants((grants) =>
        grants.grant({ accountId, role, grantedBy: null })
      );

      expect(first).toEqual({ changed: true });
      expect(repeat).toEqual({ changed: false });
      expect(await runGrants((grants) => grants.has({ accountId, role }))).toBe(
        true
      );
      const stored = await testDatabase!.pool.query(
        "select granted_by_account_id from account_role_grants where account_id = $1",
        [accountId]
      );
      expect(stored.rows).toEqual([{ granted_by_account_id: granter }]);
    });

    test("revokes a grant so the next check fails", async () => {
      const accountId = await insertAccount();
      await runGrants((grants) =>
        grants.grant({ accountId, role, grantedBy: null })
      );

      const revoked = await runGrants((grants) =>
        grants.revoke({ accountId, role })
      );
      const repeat = await runGrants((grants) =>
        grants.revoke({ accountId, role })
      );

      expect(revoked).toEqual({ changed: true });
      expect(repeat).toEqual({ changed: false });
      expect(await runGrants((grants) => grants.has({ accountId, role }))).toBe(
        false
      );
    });

    test("drops the grant with its account and keeps it when the granter goes", async () => {
      const accountId = await insertAccount();
      const granter = await insertAccount();
      await runGrants((grants) =>
        grants.grant({ accountId, role, grantedBy: granter })
      );

      await deleteAccount(granter);
      expect(await runGrants((grants) => grants.has({ accountId, role }))).toBe(
        true
      );
      const kept = await testDatabase!.pool.query(
        "select granted_by_account_id from account_role_grants where account_id = $1",
        [accountId]
      );
      expect(kept.rows).toEqual([{ granted_by_account_id: null }]);

      await deleteAccount(accountId);
      const remaining = await testDatabase!.pool.query(
        "select 1 from account_role_grants where account_id = $1",
        [accountId]
      );
      expect(remaining.rowCount).toBe(0);
    });

    test("rejects a role the application doesn't define", async () => {
      const accountId = await insertAccount();

      const insert = testDatabase!.pool.query(
        "insert into account_role_grants (account_id, role) values ($1, 'owner')",
        [accountId]
      );

      await expect(insert).rejects.toMatchObject({
        constraint: "account_role_grants_role_check",
      });
    });
  }
);
