import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testEmailAddress } from "@deskohub/test-email";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { accountRoleGrants } from "@/db/schema/account-role-grants";
import { authSession, authUser } from "@/db/schema/auth";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { removeSyntheticAuthUser } from "../account/auth-rows";
import { readWorkspaceE2EAccountJournal } from "../account/journal";
import { workspaceE2ESessionCookieName } from "../account/seeded-session";
import { E2EDatabase } from "../integrations/database.service";
import { workspaceE2ERunIdSchema } from "../run-identifiers";
import { makeWorkspaceE2EAdministrationIdentities } from "./identities";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const runId = Schema.decodeUnknownSync(workspaceE2ERunIdSchema)(
  `pg-${crypto.randomUUID()}`
);
const origin = "https://workspace-administration.test";
const journalDirectory = await mkdtemp(
  join(tmpdir(), "workspace-e2e-administration-journal-")
);

afterAll(() => rm(journalDirectory, { force: true, recursive: true }));

describe.skipIf(!testDatabase)(
  "seeded administration identities on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db } = testDatabase;
    const provide = <A, E>(effect: Effect.Effect<A, E, E2EDatabase>) =>
      Effect.runPromise(
        effect.pipe(Effect.provideService(E2EDatabase, E2EDatabase.of({ db })))
      );

    const readRows = (accountId: string) =>
      Effect.runPromise(
        Effect.all({
          grants: db
            .select({ role: accountRoleGrants.role })
            .from(accountRoleGrants)
            .where(eq(accountRoleGrants.accountId, accountId as never)),
          sessions: db
            .select({ id: authSession.id })
            .from(authSession)
            .where(eq(authSession.userId, accountId)),
          users: db
            .select({ verified: authUser.emailVerified })
            .from(authUser)
            .where(eq(authUser.id, accountId)),
        })
      );

    test("journals each account before seeding it, grants only the requested roles, and signs a context in on the preview origin only", async () => {
      const identities = makeWorkspaceE2EAdministrationIdentities<
        "pg-admin" | "pg-member"
      >({
        journalDirectory,
        ownerId: "administration-postgres",
        runId,
        secret: { value: "synthetic-administration-session-secret-0123456789" },
      });
      const administrator = await provide(
        identities.seed("pg-admin", ["administrator"])
      );
      const member = await provide(identities.seed("pg-member", []));

      const journal = await readWorkspaceE2EAccountJournal(
        "administration-postgres",
        journalDirectory
      );
      expect(journal?.authUserIds).toEqual([
        administrator.accountId,
        member.accountId,
      ]);
      expect(administrator.email).toBe(
        testEmailAddress(`delivered+${runId}-pg-admin`)
      );

      const cookies: unknown[] = [];
      await provide(
        identities.signIn(administrator, {
          context: {
            addCookies: async (added) => {
              cookies.push(...added);
            },
          },
          origin,
        })
      );
      expect(cookies).toEqual([
        {
          httpOnly: true,
          name: workspaceE2ESessionCookieName,
          sameSite: "Lax",
          secure: true,
          url: origin,
          value: expect.any(String),
        },
      ]);

      const administratorRows = await readRows(administrator.accountId);
      expect(administratorRows.users).toEqual([{ verified: true }]);
      expect(administratorRows.grants).toEqual([{ role: "administrator" }]);
      expect(administratorRows.sessions).toHaveLength(1);
      const memberRows = await readRows(member.accountId);
      expect(memberRows.users).toEqual([{ verified: true }]);
      expect(memberRows.grants).toEqual([]);

      for (const account of [administrator, member]) {
        await provide(removeSyntheticAuthUser(account.accountId));
        const remaining = await readRows(account.accountId);
        expect(remaining).toEqual({ grants: [], sessions: [], users: [] });
      }
    });
  }
);
