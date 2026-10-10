import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  AdministrationActorUsername,
  CliSessionId,
  digestCliAuthenticationSecret,
  makeCliAuthenticationSecret,
} from "@deskohub/workspace-admin-api";
import { NodeCrypto } from "@effect/platform-node";
import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
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
mock.module("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
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

const toFormData = (values: Record<string, string>) => {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }
  return formData;
};

const invokeRedirect = async (invoke: () => Promise<unknown>) => {
  const cause = await invoke().then(
    () => null,
    (cause: unknown) => cause
  );
  expect(cause).toHaveProperty("digest");
  return cause as { readonly digest: string };
};

describe.skipIf(!postgresDatabase)(
  "admin CLI actions authorize ownership from Basic authentication",
  () => {
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

    const loadSessionRow = async (id: CliSessionId) => {
      const [row] = await Effect.runPromise(
        postgres.db.select().from(cliSessions).where(eq(cliSessions.id, id))
      );
      return row ?? null;
    };

    test("revokes only the acting administrator's own session", async () => {
      const { revokeCliSession } = await import("@/features/admin-cli/actions");
      const adminSessionId = await insertSessionFixture(
        workspaceTestAdminCredentials.username
      );
      const operatorSessionId = await insertSessionFixture("operator");

      actAs(workspaceTestAdminCredentials.username);
      const foreignError = await invokeRedirect(() =>
        revokeCliSession(toFormData({ sessionId: operatorSessionId }))
      );
      expect(foreignError.digest).toContain("result=unchanged");
      expect((await loadSessionRow(operatorSessionId))?.revokedAt).toBeNull();

      const ownError = await invokeRedirect(() =>
        revokeCliSession(toFormData({ sessionId: adminSessionId }))
      );
      expect(ownError.digest).toContain("result=revoked");
      expect((await loadSessionRow(adminSessionId))?.revokedAt).not.toBeNull();
    });

    test("renames only the acting administrator's own session", async () => {
      const { renameCliSession } = await import("@/features/admin-cli/actions");
      const adminSessionId = await insertSessionFixture(
        workspaceTestAdminCredentials.username
      );
      const operatorSessionId = await insertSessionFixture("operator");

      actAs(workspaceTestAdminCredentials.username);
      const foreign = await renameCliSession({
        sessionId: operatorSessionId,
        clientName: "Stolen label",
      });
      expect(foreign).toHaveProperty("serverError");
      expect((await loadSessionRow(operatorSessionId))?.clientName).toBe(
        "operator CLI"
      );

      const own = await renameCliSession({
        sessionId: adminSessionId,
        clientName: "Office Mac",
      });
      expect(own).toHaveProperty("data");
      expect((await loadSessionRow(adminSessionId))?.clientName).toBe(
        "Office Mac"
      );
    });

    const insertPendingRequestFixture = async () => {
      const code = await Effect.runPromise(randomSecret());
      const requestId = cliAuthenticationRequestIdSchema.make(
        crypto.randomUUID()
      );
      await Effect.runPromise(
        postgres.db.insert(cliAuthenticationRequests).values({
          id: requestId,
          codeHash: await Effect.runPromise(digestSecret(code)),
          challenge: await Effect.runPromise(randomSecret()),
          clientName: "Attribution CLI",
          cliVersion: "1.0.0",
          buildTarget: "development",
          createdAt: Temporal.Now.instant(),
          expiresAt: Temporal.Now.instant().add({ minutes: 5 }),
        })
      );
      fixtureRequestIds.push(requestId);
      return { code, requestId };
    };

    const loadRequestRow = async (id: CliAuthenticationRequestId) => {
      const [row] = await Effect.runPromise(
        postgres.db
          .select()
          .from(cliAuthenticationRequests)
          .where(eq(cliAuthenticationRequests.id, id))
      );
      return row ?? null;
    };

    test("attributes approved CLI authentication requests to the acting administrator", async () => {
      const { approveCliAuthentication } = await import(
        "@/features/admin-cli/actions"
      );
      const { code, requestId } = await insertPendingRequestFixture();

      actAs("operator");
      const approvedNoEarlierThan = Temporal.Instant.fromEpochMilliseconds(
        Date.now()
      );
      const error = await invokeRedirect(() =>
        approveCliAuthentication(
          toFormData({ code, lifetimeAmount: "2", lifetimeUnit: "weeks" })
        )
      );
      expect(error.digest).toContain("result=approved");

      const row = await loadRequestRow(requestId);
      expect(row?.approvedBy).toBe("operator");
      expect(row?.approvedAt).not.toBeNull();
      expect(
        row?.approvedAt &&
          row.sessionExpiresAt?.equals(
            row.approvedAt
              .toZonedDateTimeISO("Europe/Prague")
              .add({ weeks: 2 })
              .toInstant()
          )
      ).toBe(true);
      expect(
        row?.approvedAt &&
          Temporal.Instant.compare(row.approvedAt, approvedNoEarlierThan)
      ).toBeGreaterThanOrEqual(0);
    });

    test("approves a session that never expires when the never-expire box is checked", async () => {
      const { approveCliAuthentication } = await import(
        "@/features/admin-cli/actions"
      );
      const { code, requestId } = await insertPendingRequestFixture();

      actAs("operator");
      const error = await invokeRedirect(() =>
        approveCliAuthentication(toFormData({ code, neverExpire: "on" }))
      );
      expect(error.digest).toContain("result=approved");

      const row = await loadRequestRow(requestId);
      expect(row?.approvedAt).not.toBeNull();
      expect(row?.sessionExpiresAt).toBeNull();
    });

    test("leaves the request pending when the session lifetime is invalid", async () => {
      const { approveCliAuthentication } = await import(
        "@/features/admin-cli/actions"
      );
      const { code, requestId } = await insertPendingRequestFixture();

      actAs("operator");
      const invalidLifetimes: ReadonlyArray<Record<string, string>> = [
        {},
        { lifetimeAmount: "0", lifetimeUnit: "days" },
        { lifetimeAmount: "1.5", lifetimeUnit: "days" },
        { lifetimeAmount: "1000", lifetimeUnit: "days" },
        { lifetimeAmount: "3", lifetimeUnit: "decades" },
      ];
      for (const lifetime of invalidLifetimes) {
        const error = await invokeRedirect(() =>
          approveCliAuthentication(toFormData({ code, ...lifetime }))
        );
        expect(error.digest).toContain("result=error");
      }

      expect((await loadRequestRow(requestId))?.approvedAt).toBeNull();
    });
  }
);

type CliAuthenticationRequestId = ReturnType<
  typeof cliAuthenticationRequestIdSchema.make
>;
