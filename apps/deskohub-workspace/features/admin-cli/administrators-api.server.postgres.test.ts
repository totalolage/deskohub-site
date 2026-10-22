import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationAuthentication,
  CliSessionId,
  digestCliAuthenticationSecret,
  makeCliAuthenticationSecret,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeCrypto, NodeHttpServer } from "@effect/platform-node";
import { inArray } from "drizzle-orm";
import { Effect, Layer, Redacted } from "effect";
import { HttpApiTest } from "effect/unstable/httpapi";
import { cliSessions } from "@/db/schema";
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
import { UnusedCliSessionAuthentication } from "./cli-api.test-utils";
import { CliAuthentication } from "./cli-authentication.service";
import { CliClientCompatibilityLive } from "./cli-client-version";
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

    afterAll(async () => {
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
