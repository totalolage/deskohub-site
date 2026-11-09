import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { AccountRoleGrants } from "./account-role-grants.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const runGrants = <A, E>(
  operation: (
    grants: AccountRoleGrants["Service"]
  ) => Effect.Effect<A, E, WorkspaceDatabase>
) =>
  Effect.runPromise(
    AccountRoleGrants.pipe(
      Effect.flatMap(operation),
      Effect.provide(
        AccountRoleGrants.Default.pipe(Layer.provideMerge(testDatabase!.layer))
      )
    )
  );

const insertAccount = ({ review = false } = {}) =>
  workspaceFixtures(testDatabase!.db)
    .account("role-grant", { review })
    .pipe(
      Effect.map(({ accountId }) => accountId),
      Effect.runPromise
    );

const deleteAccount = async (accountId: string) => {
  await testDatabase!.pool.query(`delete from auth."user" where id = $1`, [
    accountId,
  ]);
  await testDatabase!.pool.query(
    `delete from customer_accounts where id = $1`,
    [accountId]
  );
};

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

    test("gives a review account no role, whatever grant it has", async () => {
      const reviewAccount = await insertAccount({ review: true });
      const administrator = await insertAccount();
      for (const accountId of [reviewAccount, administrator]) {
        await runGrants((grants) =>
          grants.grant({ accountId, role, grantedBy: null })
        );
      }

      expect(
        await runGrants((grants) =>
          grants.has({ accountId: reviewAccount, role })
        )
      ).toBe(false);
      expect(
        await runGrants((grants) =>
          Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
            transaction(grants.lockHeld({ accountId: reviewAccount, role }))
          )
        )
      ).toBe(false);
      expect(
        await runGrants((grants) =>
          Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
            transaction(grants.lockHeld({ accountId: administrator, role }))
          )
        )
      ).toBe(true);
      const listed = (await runGrants((grants) => grants.list(role))).map(
        ({ accountId }) => accountId
      );
      expect(listed).toContain(administrator);
      expect(listed).not.toContain(reviewAccount);
      expect(
        await runGrants((grants) =>
          grants.revoke({ accountId: reviewAccount, role })
        )
      ).toEqual({ changed: true });
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
