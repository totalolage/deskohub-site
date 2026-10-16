import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AdministratorAccountActor } from "../account-role";
import { AccountRoleGrants } from "./account-role-grants.service";
import { AdministratorRoster } from "./administrator-roster.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const runRoster = <A, E>(
  operation: (roster: AdministratorRoster["Service"]) => Effect.Effect<A, E>
) =>
  Effect.runPromise(
    AdministratorRoster.pipe(
      Effect.flatMap(operation),
      Effect.provide(
        AdministratorRoster.Default.pipe(
          Layer.provideMerge(AccountRoleGrants.Default),
          Layer.provide(testDatabase!.layer)
        )
      )
    )
  );

const runRosterFailure = <A, E>(
  operation: (roster: AdministratorRoster["Service"]) => Effect.Effect<A, E>
) => runRoster((roster) => Effect.flip(operation(roster)));

const insertAccount = async ({
  emailVerified = true,
  deletionRequested = false,
}: {
  readonly emailVerified?: boolean;
  readonly deletionRequested?: boolean;
} = {}) => {
  const accountId = customerAccountIdSchema.make(crypto.randomUUID());
  const email = testEmailAddress(`roster-${accountId}`);
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email, email_verified, deletion_requested_at)
     values ($1, '', $2, $3, case when $4 then now() end)`,
    [accountId, email, emailVerified, deletionRequested]
  );
  const actor: AdministratorAccountActor = { accountId, email };
  return actor;
};

const grantAdministrator = (accountId: string, grantedBy: string | null) =>
  testDatabase!.pool.query(
    `insert into account_role_grants (account_id, role, granted_by_account_id)
     values ($1, 'administrator', $2)`,
    [accountId, grantedBy]
  );

const isAdministrator = async (accountId: string) =>
  (
    await testDatabase!.pool.query(
      `select 1 from account_role_grants where account_id = $1 and role = 'administrator'`,
      [accountId]
    )
  ).rowCount === 1;

describe.skipIf(!testDatabase)(
  "AdministratorRoster on disposable Postgres",
  () => {
    test("lists administrators with their granter and grant time", async () => {
      const bootstrapped = await insertAccount();
      const granted = await insertAccount();
      const orphaned = await insertAccount();
      const deletedGranter = await insertAccount();
      await grantAdministrator(bootstrapped.accountId, null);
      await grantAdministrator(granted.accountId, bootstrapped.accountId);
      await grantAdministrator(orphaned.accountId, deletedGranter.accountId);
      await testDatabase!.pool.query(`delete from auth."user" where id = $1`, [
        deletedGranter.accountId,
      ]);

      const listed = await runRoster((roster) => roster.list);
      const byAccount = new Map(
        listed.map((grant) => [grant.accountId, grant])
      );

      expect(byAccount.get(bootstrapped.accountId)).toMatchObject({
        email: bootstrapped.email,
        grantedBy: null,
      });
      expect(byAccount.get(granted.accountId)).toMatchObject({
        email: granted.email,
        grantedBy: bootstrapped,
      });
      expect(byAccount.get(orphaned.accountId)?.grantedBy).toBeNull();
      expect(byAccount.get(granted.accountId)?.grantedAt).toBeInstanceOf(
        Temporal.Instant
      );
    });

    test("grants the role to an active account found by its email", async () => {
      const actor = await insertAccount();
      const target = await insertAccount();

      const result = await runRoster((roster) =>
        roster.grant({ email: ` ${target.email.toUpperCase()} `, actor })
      );

      expect(result).toEqual({ changed: true, email: target.email });
      expect(await isAdministrator(target.accountId)).toBe(true);
      const stored = await testDatabase!.pool.query(
        "select granted_by_account_id from account_role_grants where account_id = $1",
        [target.accountId]
      );
      expect(stored.rows).toEqual([{ granted_by_account_id: actor.accountId }]);
    });

    test("reports an existing grant without changing it", async () => {
      const actor = await insertAccount();
      const target = await insertAccount();
      await grantAdministrator(target.accountId, null);

      const result = await runRoster((roster) =>
        roster.grant({ email: target.email, actor })
      );

      expect(result).toEqual({ changed: false, email: target.email });
      const stored = await testDatabase!.pool.query(
        "select granted_by_account_id from account_role_grants where account_id = $1",
        [target.accountId]
      );
      expect(stored.rows).toEqual([{ granted_by_account_id: null }]);
    });

    test.each([
      ["unknown", null],
      ["unverified", { emailVerified: false }],
      ["pending deletion", { deletionRequested: true }],
    ] as const)(
      "refuses an email with no active account (%s)",
      async (_case, accountState) => {
        const actor = await insertAccount();
        const target =
          accountState === null ? null : await insertAccount(accountState);
        const email =
          target?.email ??
          testEmailAddress(`roster-unknown-${crypto.randomUUID()}`);

        const error = await runRosterFailure((roster) =>
          roster.grant({ email, actor })
        );

        expect(error._tag).toBe("AdministratorAccountNotFoundError");
        if (target !== null) {
          expect(await isAdministrator(target.accountId)).toBe(false);
        }
      }
    );

    test("revokes another administrator's grant", async () => {
      const actor = await insertAccount();
      const target = await insertAccount();
      await grantAdministrator(target.accountId, actor.accountId);

      const revoked = await runRoster((roster) =>
        roster.revoke({ accountId: target.accountId, actor })
      );
      const repeat = await runRoster((roster) =>
        roster.revoke({ accountId: target.accountId, actor })
      );

      expect(revoked).toEqual({ changed: true });
      expect(repeat).toEqual({ changed: false });
      expect(await isAdministrator(target.accountId)).toBe(false);
    });

    test("refuses to revoke the acting administrator's own grant", async () => {
      const actor = await insertAccount();
      await grantAdministrator(actor.accountId, null);

      const error = await runRosterFailure((roster) =>
        roster.revoke({ accountId: actor.accountId, actor })
      );

      expect(error._tag).toBe("AdministratorSelfRevocationError");
      expect(await isAdministrator(actor.accountId)).toBe(true);
    });
  }
);
