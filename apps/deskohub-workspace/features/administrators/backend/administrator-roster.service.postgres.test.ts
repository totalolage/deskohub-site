import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
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

const insertAccount = ({
  emailVerified = true,
  deletionRequested = false,
  review = false,
}: {
  readonly emailVerified?: boolean;
  readonly deletionRequested?: boolean;
  readonly review?: boolean;
} = {}): Promise<AdministratorAccountActor> =>
  Effect.runPromise(
    workspaceFixtures(testDatabase!.db).account("roster", {
      verified: emailVerified,
      deletionRequested,
      review,
    })
  );

const grantAdministrator = (
  accountId: CustomerAccountId,
  grantedBy?: CustomerAccountId
) =>
  Effect.runPromise(
    workspaceFixtures(testDatabase!.db).grantRole(accountId, "administrator", {
      grantedBy,
    })
  );

const cliSecret = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

/** An unrevoked CLI session and an approved, unexchanged CLI request. */
const insertCliCredentials = async (approver: AdministratorAccountActor) => {
  const sessionId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  await testDatabase!.pool.query(
    `insert into cli_sessions
       (id, approved_by_account_id, approved_by_account_email, token_hash,
        client_name, cli_version, build_target, created_at, last_used_at)
     values ($1, $2, $3, $4, 'Roster test', '1.0.0', 'development', now(), now())`,
    [sessionId, approver.accountId, approver.email, cliSecret()]
  );
  await testDatabase!.pool.query(
    `insert into cli_authentication_requests
       (id, code_hash, challenge, client_name, cli_version, build_target,
        created_at, expires_at, approved_at, approved_by_account_id,
        approved_by_account_email, grant_token, grant_expires_at)
     values ($1, $2, $3, 'Roster test', '1.0.0', 'development', now(),
             now() + interval '5 minutes', now(), $4, $5, $6,
             now() + interval '5 minutes')`,
    [
      requestId,
      cliSecret(),
      cliSecret(),
      approver.accountId,
      approver.email,
      cliSecret(),
    ]
  );
  return { sessionId, requestId };
};

const cliCredentialsState = async (credentials: {
  readonly sessionId: string;
  readonly requestId: string;
}) => {
  const session = await testDatabase!.pool.query<{ revoked: boolean }>(
    `select revoked_at is not null as revoked from cli_sessions where id = $1`,
    [credentials.sessionId]
  );
  const request = await testDatabase!.pool.query<{ exchangeable: boolean }>(
    `select grant_token is not null as exchangeable
     from cli_authentication_requests where id = $1`,
    [credentials.requestId]
  );
  return {
    sessionRevoked: session.rows[0]?.revoked,
    grantExchangeable: request.rows[0]?.exchangeable,
  };
};

/**
 * An agent's consent to the administration and the refresh and access
 * tokens issued under it.
 */
const insertAdministrationAgent = async (
  account: AdministratorAccountActor
) => {
  const clientId = `roster-agent-${crypto.randomUUID()}`;
  const consentId = crypto.randomUUID();
  const refreshId = crypto.randomUUID();
  const scopes = ["openid", "administration"];
  await testDatabase!.pool.query(
    `insert into auth.oauth_client
       (id, client_id, scopes, redirect_uris, token_endpoint_auth_method,
        grant_types, response_types, created_at, updated_at)
     values ($1, $1, $2, $3, 'none', '{authorization_code,refresh_token}',
             '{code}', now(), now())`,
    [clientId, scopes, [`https://client.example/${clientId}`]]
  );
  await testDatabase!.pool.query(
    `insert into auth.oauth_consent
       (id, client_id, user_id, scopes, created_at, updated_at)
     values ($1, $2, $3, $4, now(), now())`,
    [consentId, clientId, account.accountId, scopes]
  );
  await testDatabase!.pool.query(
    `insert into auth.oauth_refresh_token
       (id, token, client_id, user_id, consent_id, scopes, created_at,
        expires_at)
     values ($1, $2, $3, $4, $5, $6, now(), now() + interval '30 days')`,
    [refreshId, cliSecret(), clientId, account.accountId, consentId, scopes]
  );
  await testDatabase!.pool.query(
    `insert into auth.oauth_access_token
       (id, token, client_id, user_id, consent_id, refresh_id, scopes,
        created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, now(), now() + interval '1 hour')`,
    [
      crypto.randomUUID(),
      cliSecret(),
      clientId,
      account.accountId,
      consentId,
      refreshId,
      scopes,
    ]
  );
};

const agentAccessState = async (accountId: string) => {
  const { rows } = await testDatabase!.pool.query<{
    consents: number;
    refreshTokens: number;
    accessTokens: number;
  }>(
    `select
       (select count(*)::int from auth.oauth_consent where user_id = $1) as consents,
       (select count(*)::int from auth.oauth_refresh_token where user_id = $1) as "refreshTokens",
       (select count(*)::int from auth.oauth_access_token where user_id = $1) as "accessTokens"`,
    [accountId]
  );
  return rows[0];
};

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
      await grantAdministrator(bootstrapped.accountId);
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
      await grantAdministrator(target.accountId);

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

    test("refuses a review account", async () => {
      const actor = await insertAccount();
      const target = await insertAccount({ review: true });

      const error = await runRosterFailure((roster) =>
        roster.grant({ email: target.email, actor })
      );

      expect(error._tag).toBe("AdministratorReviewAccountError");
      expect(await isAdministrator(target.accountId)).toBe(false);
    });

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

    test("ends only the revoked administrator's CLI sessions and grants", async () => {
      const actor = await insertAccount();
      const target = await insertAccount();
      await grantAdministrator(actor.accountId);
      await grantAdministrator(target.accountId, actor.accountId);
      const actorCredentials = await insertCliCredentials(actor);
      const targetCredentials = await insertCliCredentials(target);

      await runRoster((roster) =>
        roster.revoke({ accountId: target.accountId, actor })
      );

      expect(await cliCredentialsState(targetCredentials)).toEqual({
        sessionRevoked: true,
        grantExchangeable: false,
      });
      expect(await cliCredentialsState(actorCredentials)).toEqual({
        sessionRevoked: false,
        grantExchangeable: true,
      });
    });

    test("keeps the grant and CLI credentials when disconnecting agents fails", async () => {
      const actor = await insertAccount();
      const target = await insertAccount();
      await grantAdministrator(target.accountId, actor.accountId);
      const targetCredentials = await insertCliCredentials(target);
      await insertAdministrationAgent(target);
      // Agents are disconnected last, after the grant and CLI cleanup.
      const fault = `fail_agent_disconnect_${crypto.randomUUID().replaceAll("-", "")}`;
      await testDatabase!.pool.query(
        `create function ${fault}() returns trigger language plpgsql as $$ begin raise exception 'simulated agent disconnect failure'; end $$`
      );
      await testDatabase!.pool.query(
        `create trigger ${fault} before delete on auth.oauth_consent for each row when (old.user_id = '${target.accountId}') execute function ${fault}()`
      );
      try {
        await runRosterFailure((roster) =>
          roster.revoke({ accountId: target.accountId, actor })
        );
      } finally {
        await testDatabase!.pool.query(
          `drop trigger ${fault} on auth.oauth_consent`
        );
        await testDatabase!.pool.query(`drop function ${fault}()`);
      }

      expect(await isAdministrator(target.accountId)).toBe(true);
      expect(await cliCredentialsState(targetCredentials)).toEqual({
        sessionRevoked: false,
        grantExchangeable: true,
      });
      expect(await agentAccessState(target.accountId)).toEqual({
        consents: 1,
        refreshTokens: 1,
        accessTokens: 1,
      });
    });

    test("ends the CLI sessions of an account whose grant is already gone", async () => {
      const actor = await insertAccount();
      const target = await insertAccount();
      const targetCredentials = await insertCliCredentials(target);

      const revoked = await runRoster((roster) =>
        roster.revoke({ accountId: target.accountId, actor })
      );

      expect(revoked).toEqual({ changed: false });
      expect(await cliCredentialsState(targetCredentials)).toEqual({
        sessionRevoked: true,
        grantExchangeable: false,
      });
    });

    test("refuses to revoke the acting administrator's own grant", async () => {
      const actor = await insertAccount();
      await grantAdministrator(actor.accountId);

      const error = await runRosterFailure((roster) =>
        roster.revoke({ accountId: actor.accountId, actor })
      );

      expect(error._tag).toBe("AdministratorSelfRevocationError");
      expect(await isAdministrator(actor.accountId)).toBe(true);
    });
  }
);
