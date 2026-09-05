import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  AdministrationActorUsername,
  CliSessionId,
  digestCliAuthenticationSecret,
  makeCliAuthenticationSecret,
} from "@deskohub/workspace-admin-api";
import { NodeCrypto } from "@effect/platform-node";
import { inArray } from "drizzle-orm";
import { Effect } from "effect";
import * as nextServer from "next/server";
import { cliAuthenticationRequests, cliSessions } from "@/db/schema";
import { cliAuthenticationRequestIdSchema } from "@/features/admin-cli/cli-identifiers";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  workspaceTestAdminCredentials,
  workspaceTestAdministrators,
} from "@/shared/testing/workspace-test-environment";

let requestHeaders = new Headers();

mock.module("next/headers", () => ({
  headers: async () => requestHeaders,
}));
mock.module("next/server", () => ({
  ...nextServer,
  connection: async () => {},
}));

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

const toAuthorization = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

const actAs = (username: string) => {
  const credential = workspaceTestAdministrators.find(
    (candidate) => candidate.username === username
  );
  if (!credential) throw new Error(`No test credential for ${username}`);
  requestHeaders = new Headers({
    authorization: toAuthorization(credential.username, credential.password),
  });
};

const randomSecret = () =>
  makeCliAuthenticationSecret().pipe(Effect.provide(NodeCrypto.layer));

const digestSecret = (secret: string) =>
  digestCliAuthenticationSecret(secret).pipe(Effect.provide(NodeCrypto.layer));

describe.skipIf(!postgresDatabase)("admin CLI page-data projections", () => {
  const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
  const fixtureSessionIds: CliSessionId[] = [];
  const fixtureRequestIds: CliAuthenticationRequestId[] = [];

  afterEach(async () => {
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

  const insertSessionFixture = async (username: string) => {
    const id = CliSessionId.make(crypto.randomUUID());
    await Effect.runPromise(
      postgres.db.insert(cliSessions).values({
        id,
        approvedBy: AdministrationActorUsername.make(username),
        tokenHash: await Effect.runPromise(
          digestSecret(await Effect.runPromise(randomSecret()))
        ),
        clientName: `${username} CLI`,
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
    const adminSessionId = await insertSessionFixture(
      workspaceTestAdminCredentials.username
    );
    const operatorSessionId = await insertSessionFixture("operator");

    actAs(workspaceTestAdminCredentials.username);
    const adminData = await loadCliSessions();
    expect(adminData.username).toBe(workspaceTestAdminCredentials.username);
    expect(adminData.sessions.map((session) => session.id)).toEqual([
      adminSessionId,
    ]);

    actAs("operator");
    const operatorData = await loadCliSessions();
    expect(operatorData.username).toBe("operator");
    expect(operatorData.sessions.map((session) => session.id)).toEqual([
      operatorSessionId,
    ]);
  });

  test("returns the authenticated username alongside the CLI approval request", async () => {
    const { loadCliAuthenticationApproval } = await import(
      "@/features/admin-cli/page-data.server"
    );
    const code = await insertPendingRequestFixture();

    actAs("operator");
    const approval = await loadCliAuthenticationApproval(code);
    expect(approval?.username).toBe("operator");
    expect(approval?.request?.clientName).toBe("Projection CLI");
    expect(approval?.request?.state).toBe("pending");
  });

  test("keeps unknown and malformed authentication codes without a request projection", async () => {
    const { loadCliAuthenticationApproval } = await import(
      "@/features/admin-cli/page-data.server"
    );

    actAs("operator");
    const unknown = await loadCliAuthenticationApproval(
      await Effect.runPromise(randomSecret())
    );
    expect(unknown?.username).toBe("operator");
    expect(unknown?.request).toBeNull();

    const malformed = await loadCliAuthenticationApproval(
      "attacker-controlled-code"
    );
    expect(malformed).toBeNull();
  });

  test("still rejects unauthenticated page loads with the shared 404 gate", async () => {
    const pageData = await import("@/features/admin-cli/page-data.server");

    requestHeaders = new Headers();
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
