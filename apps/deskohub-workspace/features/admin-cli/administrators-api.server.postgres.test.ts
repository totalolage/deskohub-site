import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationAuthentication,
  CliAuthenticationCode,
  CliAuthenticationVerifier,
  CliGrantToken,
  CliSessionId,
  digestCliAuthenticationSecret,
  makeCliAuthenticationSecret,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeCrypto, NodeHttpServer } from "@effect/platform-node";
import { inArray } from "drizzle-orm";
import { Effect, Layer, Redacted } from "effect";
import { HttpApiTest } from "effect/unstable/httpapi";
import type { PoolClient } from "pg";
import { cliAuthenticationRequests, cliSessions } from "@/db/schema";
import {
  type CliAuthenticationRequestId,
  cliAuthenticationRequestIdSchema,
} from "@/features/admin-cli/cli-identifiers";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import { AdministratorRoster } from "@/features/administrators/backend/administrator-roster.service";
import { LegacyAdministratorBackfill } from "@/features/administrators/backend/legacy-administrator-backfill.service";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  deleteTestAccounts,
  insertTestAccount,
  insertTestAdministrator,
} from "@/shared/testing/workspace-test-accounts.test-utils";
import { AdminCliAdministratorsApiHandlers } from "./administrators-api.server";
import {
  UnrecordedAdministrationActions,
  UnusedCliSessionAuthentication,
} from "./cli-api.test-utils";
import { CliAuthentication } from "./cli-authentication.service";
import { CliClientCompatibilityLive } from "./cli-client-version";
import { cliSessionLifetimeSchema } from "./contracts";
import { CliSessionAdministrationAuthenticationLive } from "./workspace-admin-api.server";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

const administratorsClient = HttpApiTest.groups(WorkspaceAdminApi, [
  "administrators",
]).pipe(Effect.map((client) => client.administrators));
type AdministratorsClient = Effect.Success<typeof administratorsClient>;

describe.skipIf(!postgresDatabase)(
  "administrators admin API on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    const fixtureAccounts: AdministratorAccountActor[] = [];
    const fixtureSessionIds: CliSessionId[] = [];
    const fixtureRequestIds: CliAuthenticationRequestId[] = [];

    afterAll(async () => {
      if (fixtureRequestIds.length > 0) {
        await Effect.runPromise(
          postgres.db
            .delete(cliAuthenticationRequests)
            .where(inArray(cliAuthenticationRequests.id, fixtureRequestIds))
        );
      }
      if (fixtureSessionIds.length > 0) {
        await Effect.runPromise(
          postgres.db
            .delete(cliSessions)
            .where(inArray(cliSessions.id, fixtureSessionIds))
        );
      }
      await deleteTestAccounts(postgres, fixtureAccounts);
    });

    const insertAccount = async (
      options?: Parameters<typeof insertTestAccount>[2]
    ) => {
      const account = await insertTestAccount(
        postgres,
        "administrators-api",
        options
      );
      fixtureAccounts.push(account);
      return account;
    };

    const insertAdministrator = async () => {
      const administrator = await insertTestAdministrator(
        postgres,
        "administrators-api"
      );
      fixtureAccounts.push(administrator);
      return administrator;
    };

    /** A CLI session `owner` approved, and the bearer that presents it. */
    const insertSession = async (owner: AdministratorAccountActor) => {
      const bearer = await Effect.runPromise(
        makeCliAuthenticationSecret().pipe(Effect.provide(NodeCrypto.layer))
      );
      const id = CliSessionId.make(crypto.randomUUID());
      await Effect.runPromise(
        postgres.db.insert(cliSessions).values({
          id,
          approvedByAccountId: owner.accountId,
          approvedByAccountEmail: owner.email,
          tokenHash: await Effect.runPromise(
            digestCliAuthenticationSecret(bearer).pipe(
              Effect.provide(NodeCrypto.layer)
            )
          ),
          clientName: "Administrators API test",
          cliVersion: "1.0.0",
          buildTarget: "development",
          createdAt: Temporal.Now.instant(),
          lastUsedAt: Temporal.Now.instant(),
        })
      );
      fixtureSessionIds.push(id);
      return bearer;
    };

    const newSecret = () =>
      Effect.runPromise(
        makeCliAuthenticationSecret().pipe(Effect.provide(NodeCrypto.layer))
      );

    /**
     * A CLI request `approver` approved that the CLI hasn't exchanged yet,
     * or a pending one without an approver.
     */
    const insertRequest = async (approver?: AdministratorAccountActor) => {
      const code = await newSecret();
      const verifier = await newSecret();
      const grantToken = await newSecret();
      const digest = (secret: string) =>
        Effect.runPromise(
          digestCliAuthenticationSecret(secret).pipe(
            Effect.provide(NodeCrypto.layer)
          )
        );
      const id = cliAuthenticationRequestIdSchema.make(crypto.randomUUID());
      const now = Temporal.Now.instant();
      await Effect.runPromise(
        postgres.db.insert(cliAuthenticationRequests).values({
          id,
          codeHash: await digest(code),
          challenge: await digest(verifier),
          clientName: "Administrators API test",
          cliVersion: "1.0.0",
          buildTarget: "development",
          createdAt: now,
          expiresAt: now.add({ minutes: 5 }),
          ...(approver && {
            approvedAt: now,
            approvedByAccountId: approver.accountId,
            approvedByAccountEmail: approver.email,
            grantToken,
            grantExpiresAt: now.add({ minutes: 5 }),
          }),
        })
      );
      fixtureRequestIds.push(id);
      return { code, grantToken, verifier };
    };

    const runAuthentication = <A, E>(
      operation: (
        authentication: CliAuthentication["Service"]
      ) => Effect.Effect<A, E>
    ) =>
      CliAuthentication.pipe(
        Effect.flatMap(operation),
        Effect.result,
        Effect.provide(
          CliAuthentication.Default.pipe(
            Layer.provideMerge(AccountRoleGrants.Default),
            Layer.provide(Layer.merge(postgres.layer, NodeCrypto.layer))
          )
        ),
        Effect.runPromise
      );

    const exchangeGrant = (grant: {
      readonly code: string;
      readonly grantToken: string;
      readonly verifier: string;
    }) =>
      runAuthentication((authentication) =>
        authentication
          .exchange({
            code: CliAuthenticationCode.make(grant.code),
            grantToken: CliGrantToken.make(grant.grantToken),
            verifier: CliAuthenticationVerifier.make(grant.verifier),
          })
          .pipe(
            Effect.tap(({ session }) =>
              Effect.sync(() => fixtureSessionIds.push(session.id))
            )
          )
      );

    const heldTransactions = new Set<PoolClient>();

    afterEach(async () => {
      for (const client of heldTransactions) {
        await client.query("rollback");
        client.release();
      }
      heldTransactions.clear();
    });

    /**
     * Holds a transaction open on its own connection, as a concurrent
     * revoke, exchange, or approval would, until `release` commits it. A
     * failed test rolls it back.
     */
    const holdTransaction = async (
      statements: ReadonlyArray<[string, unknown[]]>
    ) => {
      const client = await postgres.pool.connect();
      heldTransactions.add(client);
      await client.query("begin");
      for (const [text, values] of statements) await client.query(text, values);
      return {
        release: async () => {
          heldTransactions.delete(client);
          await client.query("commit");
          client.release();
        },
      };
    };

    /** Resolves once `count` connections wait on another's locks. */
    const waitForBlockedConnections = async (count: number) => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const {
          rows: [row],
        } = await postgres.pool.query<{ blocked: number }>(
          `select count(*)::int as blocked from pg_stat_activity
           where cardinality(pg_blocking_pids(pid)) > 0`
        );
        if ((row?.blocked ?? 0) >= count) return;
        await Bun.sleep(10);
      }
      throw new Error(`Fewer than ${count} connections ever blocked.`);
    };

    /** An insert of a CLI session `owner` approved, and its bearer. */
    const newSessionStatement = async (owner: AdministratorAccountActor) => {
      const bearer = await newSecret();
      const tokenHash = await Effect.runPromise(
        digestCliAuthenticationSecret(bearer).pipe(
          Effect.provide(NodeCrypto.layer)
        )
      );
      const id = CliSessionId.make(crypto.randomUUID());
      fixtureSessionIds.push(id);
      const statement: [string, unknown[]] = [
        `insert into cli_sessions
           (id, approved_by_account_id, approved_by_account_email, token_hash,
            client_name, cli_version, build_target, created_at, last_used_at)
         values ($1, $2, $3, $4, 'Administrators API test', '1.0.0',
                 'development', now(), now())`,
        [id, owner.accountId, owner.email, tokenHash],
      ];
      return { bearer, id, statement };
    };

    const lockGrantForShare = (
      account: AdministratorAccountActor
    ): [string, unknown[]] => [
      `select 1 from account_role_grants
       where account_id = $1 and role = 'administrator' for share`,
      [account.accountId],
    ];

    const lockRequestForUpdate = (grant: {
      readonly grantToken: string;
    }): [string, unknown[]] => [
      `select 1 from cli_authentication_requests
       where grant_token = $1 for update`,
      [grant.grantToken],
    ];

    const consumeRequest = (
      grant: { readonly grantToken: string },
      sessionId: CliSessionId
    ): [string, unknown[]] => [
      `update cli_authentication_requests
       set consumed_at = now(), grant_token = null, session_id = $2
       where grant_token = $1`,
      [grant.grantToken, sessionId],
    ];

    const deleteGrant = (
      account: AdministratorAccountActor
    ): [string, unknown[]] => [
      `delete from account_role_grants
       where account_id = $1 and role = 'administrator'`,
      [account.accountId],
    ];

    /**
     * The in-memory client sends no Authorization header, so this hands
     * `bearer` to the real CLI session authentication, which checks the
     * session and its approver's live grant on every request.
     */
    const presentingBearer = (bearer: string) =>
      Layer.effect(
        AdministrationAuthentication,
        AdministrationAuthentication.pipe(
          Effect.map((authentication) => ({
            bearer: (httpEffect, options) =>
              authentication.bearer(httpEffect, {
                ...options,
                credential: Redacted.make(bearer),
              }),
          }))
        )
      ).pipe(Layer.provide(CliSessionAdministrationAuthenticationLive));

    const callAs = <A, E>(
      bearer: string,
      call: (client: AdministratorsClient) => Effect.Effect<A, E>
    ) =>
      administratorsClient.pipe(
        Effect.flatMap(call),
        Effect.result,
        Effect.provide(AdminCliAdministratorsApiHandlers),
        Effect.provide(
          Layer.mergeAll(
            presentingBearer(bearer),
            UnusedCliSessionAuthentication
          )
        ),
        Effect.provide(
          Layer.mergeAll(
            AdministratorRoster.Default,
            CliAuthentication.Default,
            Layer.succeed(LegacyAdministratorBackfill, {
              run: () => Effect.die("The legacy backfill isn't under test."),
            })
          ).pipe(
            Layer.provideMerge(AccountRoleGrants.Default),
            Layer.provide(Layer.merge(postgres.layer, NodeCrypto.layer))
          )
        ),
        Effect.provide(CliClientCompatibilityLive),
        Effect.provide(UnrecordedAdministrationActions),
        Effect.provide(NodeHttpServer.layerHttpServices),
        Effect.scoped,
        Effect.runPromise
      );

    const grantRow = async (accountId: string) =>
      (
        await postgres.pool.query<{ granted_by_account_id: string | null }>(
          `select granted_by_account_id from account_role_grants
           where account_id = $1 and role = 'administrator'`,
          [accountId]
        )
      ).rows[0] ?? null;

    test("lists administrators with the account that granted each role", async () => {
      const actor = await insertAdministrator();
      const bearer = await insertSession(actor);
      const target = await insertAccount();
      await postgres.pool.query(
        `insert into account_role_grants (account_id, role, granted_by_account_id)
         values ($1, 'administrator', $2)`,
        [target.accountId, actor.accountId]
      );

      const outcome = await callAs(bearer, (client) =>
        client.listAdministrators({})
      );

      expect(outcome._tag).toBe("Success");
      const listed =
        outcome._tag === "Success"
          ? outcome.success.administrators.filter(({ accountId }) =>
              [actor.accountId, target.accountId].includes(accountId)
            )
          : [];
      expect(listed).toMatchObject([
        {
          accountId: actor.accountId,
          email: actor.email,
          grantedByEmail: null,
        },
        {
          accountId: target.accountId,
          email: target.email,
          grantedByEmail: actor.email,
        },
      ]);
    });

    test("grants the role to an active account, attributed to the session's administrator", async () => {
      const actor = await insertAdministrator();
      const bearer = await insertSession(actor);
      const target = await insertAccount();

      const granted = await callAs(bearer, (client) =>
        client.grantAdministrator({ payload: { email: target.email } })
      );
      const repeated = await callAs(bearer, (client) =>
        client.grantAdministrator({ payload: { email: target.email } })
      );

      expect(granted).toMatchObject({
        _tag: "Success",
        success: { outcome: "granted", email: target.email },
      });
      expect(repeated).toMatchObject({
        _tag: "Success",
        success: { outcome: "already_granted", email: target.email },
      });
      expect(await grantRow(target.accountId)).toEqual({
        granted_by_account_id: actor.accountId,
      });
    });

    test.each([
      ["an unverified", { emailVerified: false }],
      ["a pending-deletion", { deletionRequested: true }],
    ] as const)(
      "refuses to grant the role to %s account",
      async (_, options) => {
        const actor = await insertAdministrator();
        const bearer = await insertSession(actor);
        const target = await insertAccount(options);

        const outcome = await callAs(bearer, (client) =>
          client.grantAdministrator({ payload: { email: target.email } })
        );

        expect(outcome).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "CliResourceNotFound" },
        });
        expect(await grantRow(target.accountId)).toBeNull();
      }
    );

    test("refuses to grant the role to a review account", async () => {
      const actor = await insertAdministrator();
      const bearer = await insertSession(actor);
      const target = await insertAccount({ review: true });

      const outcome = await callAs(bearer, (client) =>
        client.grantAdministrator({ payload: { email: target.email } })
      );

      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CliMutationRejected" },
      });
      expect(await grantRow(target.accountId)).toBeNull();
    });

    test("refuses to grant the role to an email no account signs in with", async () => {
      const actor = await insertAdministrator();
      const bearer = await insertSession(actor);

      const outcome = await callAs(bearer, (client) =>
        client.grantAdministrator({
          payload: {
            email: testEmailAddress(`missing-${crypto.randomUUID()}`),
          },
        })
      );

      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CliResourceNotFound" },
      });
    });

    test("refuses to revoke the session administrator's own grant", async () => {
      const actor = await insertAdministrator();
      const bearer = await insertSession(actor);

      const outcome = await callAs(bearer, (client) =>
        client.revokeAdministrator({ params: { accountId: actor.accountId } })
      );

      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CliMutationRejected" },
      });
      expect(await grantRow(actor.accountId)).not.toBeNull();
    });

    test("revokes another administrator, whose session then stops working", async () => {
      const actor = await insertAdministrator();
      const bearer = await insertSession(actor);
      const target = await insertAdministrator();
      const targetBearer = await insertSession(target);

      const revoked = await callAs(bearer, (client) =>
        client.revokeAdministrator({ params: { accountId: target.accountId } })
      );
      const repeated = await callAs(bearer, (client) =>
        client.revokeAdministrator({ params: { accountId: target.accountId } })
      );
      const revokedCaller = await callAs(targetBearer, (client) =>
        client.grantAdministrator({ payload: { email: target.email } })
      );

      expect(revoked).toMatchObject({
        _tag: "Success",
        success: { outcome: "revoked" },
      });
      expect(repeated).toMatchObject({
        _tag: "Success",
        success: { outcome: "not_administrator" },
      });
      expect(revokedCaller).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CliSessionUnauthorized" },
      });
      expect(await grantRow(target.accountId)).toBeNull();
    });

    test("a re-grant revives neither the revoked administrator's CLI sessions nor their approved CLI grants", async () => {
      const actor = await insertAdministrator();
      const bearer = await insertSession(actor);
      const bystander = await insertAdministrator();
      const bystanderBearer = await insertSession(bystander);
      const target = await insertAdministrator();
      const targetBearer = await insertSession(target);
      const targetGrant = await insertRequest(target);

      const revoked = await callAs(bearer, (client) =>
        client.revokeAdministrator({ params: { accountId: target.accountId } })
      );
      const regranted = await callAs(bearer, (client) =>
        client.grantAdministrator({ payload: { email: target.email } })
      );
      const targetAfterRegrant = await callAs(targetBearer, (client) =>
        client.listAdministrators({})
      );
      const exchanged = await exchangeGrant(targetGrant);
      const bystanderAfterRevoke = await callAs(bystanderBearer, (client) =>
        client.listAdministrators({})
      );

      expect(revoked).toMatchObject({
        _tag: "Success",
        success: { outcome: "revoked" },
      });
      expect(regranted).toMatchObject({
        _tag: "Success",
        success: { outcome: "granted" },
      });
      expect(targetAfterRegrant).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CliSessionUnauthorized" },
      });
      expect(exchanged).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CliGrantRejected" },
      });
      expect(bystanderAfterRevoke._tag).toBe("Success");
    });

    test("a revoke waits for an in-flight CLI exchange and revokes the session it creates", async () => {
      const actor = await insertAdministrator();
      const bearer = await insertSession(actor);
      const target = await insertAdministrator();
      const exchangedSession = await newSessionStatement(target);
      const exchange = await holdTransaction([
        lockGrantForShare(target),
        exchangedSession.statement,
      ]);

      const revoking = callAs(bearer, (client) =>
        client.revokeAdministrator({ params: { accountId: target.accountId } })
      );
      await waitForBlockedConnections(1);
      await exchange.release();
      const revoked = await revoking;
      await callAs(bearer, (client) =>
        client.grantAdministrator({ payload: { email: target.email } })
      );
      const exchangedAfterRegrant = await callAs(
        exchangedSession.bearer,
        (client) => client.listAdministrators({})
      );

      expect(revoked).toMatchObject({
        _tag: "Success",
        success: { outcome: "revoked" },
      });
      expect(exchangedAfterRegrant).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CliSessionUnauthorized" },
      });
    });

    test("a revoke waits for a real CLI exchange to commit and revokes its session", async () => {
      const actor = await insertAdministrator();
      const bearer = await insertSession(actor);
      const target = await insertAdministrator();
      const targetGrant = await insertRequest(target);
      // Stalls the exchange at consumption, after it locked the grant and
      // inserted its session.
      const requestLock = await holdTransaction([
        lockRequestForUpdate(targetGrant),
      ]);

      const exchanging = exchangeGrant(targetGrant);
      await waitForBlockedConnections(1);
      const revoking = callAs(bearer, (client) =>
        client.revokeAdministrator({ params: { accountId: target.accountId } })
      );
      await waitForBlockedConnections(2);
      await requestLock.release();
      const exchanged = await exchanging;
      const revoked = await revoking;
      await callAs(bearer, (client) =>
        client.grantAdministrator({ payload: { email: target.email } })
      );

      expect(exchanged._tag).toBe("Success");
      expect(revoked).toMatchObject({
        _tag: "Success",
        success: { outcome: "revoked" },
      });
      expect(
        exchanged._tag === "Success"
          ? await callAs(exchanged.success.accessToken, (client) =>
              client.listAdministrators({})
            )
          : null
      ).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CliSessionUnauthorized" },
      });
    });

    test("revoking an account without the grant revokes a session an in-flight exchange commits", async () => {
      const actor = await insertAdministrator();
      const bearer = await insertSession(actor);
      const target = await insertAccount();
      const targetGrant = await insertRequest(target);
      const exchangedSession = await newSessionStatement(target);
      // An exchange that already passed its grant check under an earlier
      // grant: its session and consumption are written but uncommitted.
      const exchange = await holdTransaction([
        exchangedSession.statement,
        consumeRequest(targetGrant, exchangedSession.id),
      ]);

      const revoking = callAs(bearer, (client) =>
        client.revokeAdministrator({ params: { accountId: target.accountId } })
      );
      await waitForBlockedConnections(1);
      await exchange.release();
      const revoked = await revoking;
      await callAs(bearer, (client) =>
        client.grantAdministrator({ payload: { email: target.email } })
      );
      const exchangedAfterRegrant = await callAs(
        exchangedSession.bearer,
        (client) => client.listAdministrators({})
      );

      expect(revoked).toMatchObject({
        _tag: "Success",
        success: { outcome: "not_administrator" },
      });
      expect(exchangedAfterRegrant).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CliSessionUnauthorized" },
      });
    });

    test("a CLI exchange waits for an in-flight revoke and then rejects the grant", async () => {
      const target = await insertAdministrator();
      const targetGrant = await insertRequest(target);
      const revoke = await holdTransaction([deleteGrant(target)]);

      const exchanging = exchangeGrant(targetGrant);
      await waitForBlockedConnections(1);
      await revoke.release();

      expect(await exchanging).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CliGrantRejected" },
      });
    });

    test("a CLI approval waits for an in-flight revoke and then refuses", async () => {
      const target = await insertAdministrator();
      const pending = await insertRequest();
      const revoke = await holdTransaction([deleteGrant(target)]);

      const approving = runAuthentication((authentication) =>
        authentication.approve({
          code: CliAuthenticationCode.make(pending.code),
          approvedBy: target,
          sessionLifetime: cliSessionLifetimeSchema.cases.Never.make({}),
        })
      );
      await waitForBlockedConnections(1);
      await revoke.release();

      expect(await approving).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CliApprovalUnavailableError" },
      });
    });

    test("rejects a bearer that presents no session", async () => {
      const target = await insertAccount();
      const unknownBearer = await Effect.runPromise(
        makeCliAuthenticationSecret().pipe(Effect.provide(NodeCrypto.layer))
      );

      const outcome = await callAs(unknownBearer, (client) =>
        client.grantAdministrator({ payload: { email: target.email } })
      );

      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CliSessionUnauthorized" },
      });
      expect(await grantRow(target.accountId)).toBeNull();
    });
  }
);
