import "@/shared/testing/workspace-test-env";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  CliSessionId,
  digestCliAuthenticationSecret,
  makeCliAuthenticationSecret,
} from "@deskohub/workspace-admin-api";
import { NodeCrypto } from "@effect/platform-node";
import { inArray } from "drizzle-orm";
import { Effect } from "effect";
import { cliAuthenticationRequests, cliSessions } from "@/db/schema";
import { cliAuthenticationRequestIdSchema } from "@/features/admin-cli/cli-identifiers";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { mockAdministratorAccess } from "@/features/administrators/server/administrator-access.test-utils";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";

const access = mockAdministratorAccess(`cli-page-${crypto.randomUUID()}`);

mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () => new Headers(),
}));
mock.module("next/server", () => ({
  after: () => undefined,
  connection: () => Promise.resolve(),
}));

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

const randomSecret = () =>
  makeCliAuthenticationSecret().pipe(Effect.provide(NodeCrypto.layer));

const digestSecret = (secret: string) =>
  digestCliAuthenticationSecret(secret).pipe(Effect.provide(NodeCrypto.layer));

describe.skipIf(!postgresDatabase)("admin CLI page-data projections", () => {
  const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
  const fixtureSessionIds: CliSessionId[] = [];
  const fixtureRequestIds: CliAuthenticationRequestId[] = [];
  let admin: AdministratorAccountActor;
  let operator: AdministratorAccountActor;

  beforeAll(async () => {
    admin = await Effect.runPromise(
      workspaceFixtures(postgres.db).account("cli-page-admin", {
        id: access.administrator.accountId,
        email: access.administrator.email,
        roles: ["administrator"],
      })
    );
    operator = await Effect.runPromise(
      workspaceFixtures(postgres.db).account("cli-page-operator", {
        roles: ["administrator"],
      })
    );
  });

  afterAll(() =>
    Effect.runPromise(
      workspaceFixtures(postgres.db).deleteAccounts([admin, operator])
    )
  );

  afterEach(async () => {
    access.set("administrator");
    const requestIds = [...fixtureRequestIds];
    const sessionIds = [...fixtureSessionIds];
    fixtureRequestIds.length = 0;
    fixtureSessionIds.length = 0;
    if (requestIds.length > 0) {
      await Effect.runPromise(
        postgres.db
          .delete(cliAuthenticationRequests)
          .where(inArray(cliAuthenticationRequests.id, requestIds))
      );
    }
    if (sessionIds.length > 0) {
      await Effect.runPromise(
        postgres.db
          .delete(cliSessions)
          .where(inArray(cliSessions.id, sessionIds))
      );
    }
  });

  const insertSessionFixture = async (owner: AdministratorAccountActor) => {
    const id = CliSessionId.make(crypto.randomUUID());
    await Effect.runPromise(
      postgres.db.insert(cliSessions).values({
        id,
        approvedByAccountId: owner.accountId,
        approvedByAccountEmail: owner.email,
        tokenHash: await Effect.runPromise(
          digestSecret(await Effect.runPromise(randomSecret()))
        ),
        clientName: "Fixture CLI",
        cliVersion: "1.0.0",
        buildTarget: "development",
        createdAt: Temporal.Instant.from("2026-08-10T10:00:00.000Z"),
        lastUsedAt: Temporal.Instant.from("2026-08-10T10:00:00.000Z"),
      })
    );
    fixtureSessionIds.push(id);
    return id;
  };

  const insertPendingRequestFixture = async () => {
    const code = await Effect.runPromise(randomSecret());
    const id = cliAuthenticationRequestIdSchema.make(crypto.randomUUID());
    await Effect.runPromise(
      postgres.db.insert(cliAuthenticationRequests).values({
        id,
        codeHash: await Effect.runPromise(digestSecret(code)),
        challenge: await Effect.runPromise(randomSecret()),
        clientName: "Projection CLI",
        cliVersion: "1.0.0",
        buildTarget: "development",
        createdAt: Temporal.Now.instant(),
        expiresAt: Temporal.Now.instant().add({ minutes: 5 }),
      })
    );
    fixtureRequestIds.push(id);
    return code;
  };

  test("scopes the session list to the page-authenticated administrator", async () => {
    const { loadCliSessions } = await import(
      "@/features/admin-cli/page-data.server"
    );
    const adminSessionId = await insertSessionFixture(admin);
    await insertSessionFixture(operator);

    const adminData = await loadCliSessions();
    expect(adminData.administratorEmail).toBe(admin.email);
    expect(adminData.sessions.map((session) => session.id)).toEqual([
      adminSessionId,
    ]);
  });

  test("returns the administrator's email alongside the CLI approval request", async () => {
    const { loadCliAuthenticationApproval } = await import(
      "@/features/admin-cli/page-data.server"
    );
    const code = await insertPendingRequestFixture();

    const approval = await loadCliAuthenticationApproval(code);
    expect(approval?.administratorEmail).toBe(admin.email);
    expect(approval?.request?.clientName).toBe("Projection CLI");
    expect(approval?.request?.state).toBe("pending");
  });

  test("keeps unknown and malformed authentication codes without a request projection", async () => {
    const { loadCliAuthenticationApproval } = await import(
      "@/features/admin-cli/page-data.server"
    );

    const unknown = await loadCliAuthenticationApproval(
      await Effect.runPromise(randomSecret())
    );
    expect(unknown?.administratorEmail).toBe(admin.email);
    expect(unknown?.request).toBeNull();

    const malformed = await loadCliAuthenticationApproval(
      "attacker-controlled-code"
    );
    expect(malformed).toBeNull();
  });

  test("loads nothing when the page gate rejects the visitor", async () => {
    const pageData = await import("@/features/admin-cli/page-data.server");

    access.set("not-administrator");
    const error = await pageData.loadCliSessions().then(
      () => null,
      (cause: unknown) => cause
    );
    expect(error).toHaveProperty("digest", "NEXT_HTTP_ERROR_FALLBACK;404");
  });
});

type CliAuthenticationRequestId = ReturnType<
  typeof cliAuthenticationRequestIdSchema.make
>;
