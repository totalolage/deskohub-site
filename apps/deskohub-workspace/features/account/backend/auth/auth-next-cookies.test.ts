import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { makeNodePostgresDatabase } from "@/db/database-client";
import {
  authAccount,
  authRateLimit,
  authSession,
  authUser,
  authVerification,
} from "@/db/schema/auth";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { type MagicLinkSendFunction, makeWorkspaceAuth } from "./auth-server";

const testDatabase = await connectWorkspacePostgresTestDatabase();

type RecordedCookieOptions = {
  readonly maxAge?: number;
};

type RecordedCookieSet = {
  readonly name: string;
  readonly value: string;
  readonly options?: RecordedCookieOptions;
};

const cookieStoreSets: RecordedCookieSet[] = [];
let requestHeaders = new Headers();

/**
 * Stands in for the Next.js request-scoped cookie store a Server Action
 * would see, so the tests observe the cookies the `nextCookies` plugin
 * forwards for direct `auth.api` calls instead of trusting its presence.
 */
mock.module("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({
    set: (name: string, value: string, options?: RecordedCookieOptions) => {
      cookieStoreSets.push({ name, value, options });
    },
  }),
}));

const SECRET_V1 = Buffer.alloc(48, 31).toString("base64url");
const HOST = "workspace.test";

const makeTestAuth = (sentMagicLinks: { url: string }[] = []) => {
  const sendMagicLink: MagicLinkSendFunction = (data) => {
    sentMagicLinks.push({ url: data.url });
  };
  return makeWorkspaceAuth({
    database: drizzleAdapter(makeNodePostgresDatabase(testDatabase!.pool), {
      provider: "pg",
      schema: {
        user: authUser,
        session: authSession,
        account: authAccount,
        verification: authVerification,
        rateLimit: authRateLimit,
      },
      schemaName: "auth",
    }),
    secrets: [{ version: 1, value: SECRET_V1 }],
    allowedHosts: [HOST],
    httpsOnly: true,
    sendMagicLink,
    beforeDeleteUser: () => Promise.resolve(),
  });
};

const uniqueEmail = (label: string) =>
  `${label}-${crypto.randomUUID()}@deskohub.test`;

const runIpOctet = Math.floor(Math.random() * 200) + 20;
let ipCounter = 0;
const uniqueIp = () => {
  ipCounter += 1;
  return `172.${runIpOctet}.${ipCounter >> 8}.${ipCounter & 0xff}`;
};

const callHandler = (
  auth: ReturnType<typeof makeTestAuth>,
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

const signInAndVerify = async (
  auth: ReturnType<typeof makeTestAuth>,
  sentMagicLinks: { url: string }[],
  email: string
) => {
  await callHandler(auth, "/sign-in/magic-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const verifyPath = sentMagicLinks[0]!.url.slice(
    `https://${HOST}/api/auth`.length
  );
  const verified = await callHandler(auth, verifyPath);
  const cookie = verified.headers
    .getSetCookie()
    .find((entry) => entry.includes("session_token="))!
    .split(";")[0]!;
  return cookie;
};

const userIdForEmail = async (email: string) => {
  const result = await testDatabase!.pool.query(
    `select id from auth."user" where email = $1`,
    [email]
  );
  return result.rows[0]?.id as string | undefined;
};

const sessionExpiresAt = async (email: string) => {
  const result = await testDatabase!.pool.query(
    `select expires_at from auth.session where user_id = $1`,
    [await userIdForEmail(email)]
  );
  return new Date(result.rows[0]!.expires_at).getTime();
};

const recordedSessionTokenSet = () =>
  cookieStoreSets.find((entry) => entry.name.endsWith("session_token"));

const backdateSession = async (email: string) => {
  await testDatabase!.pool.query(
    `update auth.session
        set expires_at = now() + interval '28 days'
      where user_id = (select id from auth."user" where email = $1)`,
    [email]
  );
};

describe.skipIf(!testDatabase)(
  "Better Auth Next.js cookie integration on the migrated disposable Postgres",
  () => {
    test("keeps nextCookies as the last plugin so Server Action cookies are not missed", () => {
      const auth = makeTestAuth();
      const plugins = auth.options.plugins ?? [];
      expect(plugins.at(-1)?.id).toBe("next-cookies");
    });

    test("clears the browser session cookie when the delete-user call runs from a Server Action", async () => {
      const sentMagicLinks: { url: string }[] = [];
      const auth = makeTestAuth(sentMagicLinks);
      const email = uniqueEmail("delete-cookies");
      const cookie = await signInAndVerify(auth, sentMagicLinks, email);

      cookieStoreSets.length = 0;
      await auth.api.deleteUser({
        body: {},
        headers: new Headers({
          origin: `https://${HOST}`,
          host: HOST,
          "content-type": "application/json",
          cookie,
        }),
      });

      const userId = await userIdForEmail(email);
      expect(userId).toBeUndefined();

      const cleared = recordedSessionTokenSet();
      expect(cleared).toBeTruthy();
      expect(cleared!.value).toBe("");
      expect(cleared!.options?.maxAge).toBe(0);
    });

    test("refreshes the rolling session cookie for browser get-session requests", async () => {
      const sentMagicLinks: { url: string }[] = [];
      const auth = makeTestAuth(sentMagicLinks);
      const email = uniqueEmail("browser-refresh");
      const cookie = await signInAndVerify(auth, sentMagicLinks, email);
      await backdateSession(email);
      const staleExpiry = await sessionExpiresAt(email);

      const response = await callHandler(auth, "/get-session", {
        headers: { cookie },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).not.toBeNull();

      expect(await sessionExpiresAt(email)).toBeGreaterThan(staleExpiry);

      const refreshedCookie = response.headers
        .getSetCookie()
        .find((entry) => entry.includes("session_token="));
      expect(refreshedCookie).toBeTruthy();
      expect(refreshedCookie).toContain("Max-Age=2592000");
    });

    test("defers the rolling refresh on RSC get-session reads that cannot write cookies", async () => {
      const sentMagicLinks: { url: string }[] = [];
      const auth = makeTestAuth(sentMagicLinks);
      const email = uniqueEmail("rsc-defer");
      const cookie = await signInAndVerify(auth, sentMagicLinks, email);
      await backdateSession(email);
      const staleExpiry = await sessionExpiresAt(email);

      cookieStoreSets.length = 0;
      requestHeaders = new Headers({ host: HOST, RSC: "1" });
      const session = await auth.api.getSession({
        headers: new Headers({
          host: HOST,
          RSC: "1",
          cookie,
        }),
      });
      expect(session?.user.email).toBe(email);

      expect(await sessionExpiresAt(email)).toBe(staleExpiry);
      expect(recordedSessionTokenSet()).toBeUndefined();
    });

    test("keeps the refresh-free server read from rolling the session ahead of the browser cookie", async () => {
      const sentMagicLinks: { url: string }[] = [];
      const auth = makeTestAuth(sentMagicLinks);
      const email = uniqueEmail("server-read");
      const cookie = await signInAndVerify(auth, sentMagicLinks, email);
      await backdateSession(email);
      const staleExpiry = await sessionExpiresAt(email);

      // A hard reload carries no `RSC` header, so the header skip cannot
      // protect it: the authoritative server read must not touch the
      // database expiry the browser cannot see a refreshed cookie for.
      requestHeaders = new Headers({ host: HOST });
      const session = await auth.api.getSession({
        query: { disableRefresh: true },
        headers: new Headers({ host: HOST, cookie }),
      });
      expect(session?.user.email).toBe(email);
      expect(await sessionExpiresAt(email)).toBe(staleExpiry);

      // The browser get-session route handler owns the rolling refresh.
      const response = await callHandler(auth, "/get-session", {
        headers: { cookie },
      });
      expect(response.status).toBe(200);

      expect(await sessionExpiresAt(email)).toBeGreaterThan(staleExpiry);
      const refreshedCookie = response.headers
        .getSetCookie()
        .find((entry) => entry.includes("session_token="));
      expect(refreshedCookie).toContain("Max-Age=2592000");
    });
  }
);
