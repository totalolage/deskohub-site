import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { describe, expect, spyOn, test } from "bun:test";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { Effect } from "effect";
import { makeAuthDatabase } from "@/db/auth-database-client";
import { drizzleAuthTables } from "@/db/schema/auth";
import { env } from "@/env";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { makeWorkspaceAuth } from "./auth/auth-server";
import {
  CustomerAuthentication,
  makeAuthoritySessionRead,
} from "./customer-authentication.service";
import { findSavedLocalePreference } from "./saved-locale-preference";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const HOST = "workspace.test";
const SECRET = Buffer.alloc(48, 47).toString("base64url");

/**
 * Rate-limit rows are keyed by client IP and shared across suites. The
 * second octet 221 is reserved for this file (auth-handler uses 16,
 * auth-next-cookies 20..219, auth-guard-session-reads 220), and the random
 * third octet keeps repeated runs apart.
 */
const runIpSubnet = Math.floor(Math.random() * 256);
let ipCounter = 0;
const uniqueIp = () => {
  ipCounter += 1;
  return `172.221.${runIpSubnet}.${ipCounter & 0xff}`;
};

describe.skipIf(!testDatabase)(
  "saved locale preference through Better Auth on disposable Postgres",
  () => {
    // Built only inside tests: registration runs even when the suite is
    // skipped without a database.
    const makeAuth = (sentMagicLinks: string[]) =>
      makeWorkspaceAuth({
        database: drizzleAdapter(makeAuthDatabase(testDatabase!.pool), {
          provider: "pg",
          schema: drizzleAuthTables,
          schemaName: "auth",
        }),
        secrets: [{ version: 1, value: SECRET }],
        allowedHosts: [HOST],
        passkeyRelyingParty: { rpID: HOST, origins: [`https://${HOST}`] },
        arePasskeysEnabled: async () => false,
        httpsOnly: true,
        sendMagicLink: (data) => {
          sentMagicLinks.push(data.url);
        },
        beforeDeleteUser: () => Effect.void,
        captureAccountLocalePreference: () => Effect.void,
      });

    const callHandler = (
      auth: ReturnType<typeof makeAuth>,
      path: string,
      init: RequestInit = {}
    ) =>
      auth.handler(
        new Request(`https://${HOST}/api/auth${path}`, {
          ...init,
          headers: {
            origin: `https://${HOST}`,
            host: HOST,
            "x-vercel-forwarded-for": uniqueIp(),
            ...((init.headers as Record<string, string>) ?? {}),
          },
        })
      );

    /**
     * Signs a new synthetic customer in and returns its session cookie. The
     * account gets `locale` as its saved preference; null makes it a legacy
     * account without one.
     */
    const signIn = async (options: {
      readonly locale: "cs-CZ" | "en-US" | null;
    }) => {
      const sentMagicLinks: string[] = [];
      const auth = makeAuth(sentMagicLinks);
      const email = testEmailAddress(`saved-locale-${crypto.randomUUID()}`);
      await callHandler(auth, "/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const verified = await callHandler(
        auth,
        sentMagicLinks[0]!.slice(`https://${HOST}/api/auth`.length)
      );
      const cookie = verified.headers
        .getSetCookie()
        .find((entry) => entry.includes("session_token="))!
        .split(";")[0]!;
      const {
        rows: [user],
      } = await testDatabase!.pool.query(
        `select id from auth."user" where email = $1`,
        [email]
      );
      await testDatabase!.pool.query(
        `update auth."user" set locale = $2 where id = $1`,
        [user.id, options.locale]
      );
      return { auth, cookie, accountId: user.id as string };
    };

    /** The reader over the real Better Auth session read of one request. */
    const find = (auth: ReturnType<typeof makeAuth>, cookie: string) =>
      Effect.runPromise(
        findSavedLocalePreference.pipe(
          Effect.provide(
            CustomerAuthentication.fromEnvironment({
              readBetterAuthSecretsRaw: () => env.BETTER_AUTH_SECRETS,
              readCurrentSession: makeAuthoritySessionRead({
                readRequestHeaders: async () =>
                  new Headers({ host: HOST, cookie }),
                loadAuthority: async () => ({ auth }),
              }),
            })
          )
        )
      );

    test("reads the session, its account, and the locale preference in one query", async () => {
      const { auth, cookie } = await signIn({ locale: "cs-CZ" });
      const queries = spyOn(testDatabase!.pool, "query");
      try {
        await expect(find(auth, cookie)).resolves.toBe("cs-CZ");
        expect(queries).toHaveBeenCalledTimes(1);
      } finally {
        queries.mockRestore();
      }
    });

    test("keeps the preference of an account pending deletion", async () => {
      const { auth, cookie, accountId } = await signIn({ locale: "cs-CZ" });
      await testDatabase!.pool.query(
        `update auth."user" set deletion_requested_at = now() where id = $1`,
        [accountId]
      );

      await expect(find(auth, cookie)).resolves.toBe("cs-CZ");
    });

    test("has no preference for a legacy account without a saved locale", async () => {
      const { auth, cookie } = await signIn({ locale: null });

      await expect(find(auth, cookie)).resolves.toBeUndefined();
    });

    test("ignores expired, revoked, forged, and unverified sessions", async () => {
      const expired = await signIn({ locale: "cs-CZ" });
      await testDatabase!.pool.query(
        `update auth.session set expires_at = now() - interval '1 minute' where user_id = $1`,
        [expired.accountId]
      );
      const revoked = await signIn({ locale: "cs-CZ" });
      await testDatabase!.pool.query(
        `delete from auth.session where user_id = $1`,
        [revoked.accountId]
      );
      const forged = await signIn({ locale: "cs-CZ" });
      const [name, signedValue] = forged.cookie.split("=");
      const [token] = decodeURIComponent(signedValue!).split(".");
      const unverified = await signIn({ locale: "cs-CZ" });
      await testDatabase!.pool.query(
        `update auth."user" set email_verified = false where id = $1`,
        [unverified.accountId]
      );

      await expect(find(expired.auth, expired.cookie)).resolves.toBeUndefined();
      await expect(find(revoked.auth, revoked.cookie)).resolves.toBeUndefined();
      // The bare token of a live session, unsigned or with a forged signature.
      await expect(
        find(forged.auth, `${name}=${token}`)
      ).resolves.toBeUndefined();
      await expect(
        find(forged.auth, `${name}=${token}.forged-signature`)
      ).resolves.toBeUndefined();
      await expect(
        find(unverified.auth, unverified.cookie)
      ).resolves.toBeUndefined();
      // The live session itself still reads its preference.
      await expect(find(forged.auth, forged.cookie)).resolves.toBe("cs-CZ");
    });
  }
);
