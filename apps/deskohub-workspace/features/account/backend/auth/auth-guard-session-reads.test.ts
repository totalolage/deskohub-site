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

type RecordedCookieSet = {
  readonly name: string;
  readonly value: string;
};

const cookieStoreSets: RecordedCookieSet[] = [];
const requestHeaders = new Headers();

/**
 * Stands in for the Next.js request-scoped cookie and header stores a
 * Server Action would see, so the tests observe the cookies the
 * `nextCookies` plugin forwards for direct `auth.api` calls instead of
 * trusting its presence.
 */
mock.module("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({
    set: (name: string, value: string) => {
      cookieStoreSets.push({ name, value });
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

/**
 * Rate-limit state lives in the shared `auth.rate_limit` table keyed by
 * client IP and path, so every suite that floods requests needs request
 * identities no other suite or earlier run has saturated. The second
 * octet 220 is reserved for this file: auth-next-cookies.test.ts draws
 * its second octet from 20..219, so the suites can never collide, and the
 * per-run random third octet keeps repeated runs of this file from
 * reusing rows persisted by earlier runs.
 */
const fileIpOctet = 220;
const runIpSubnet = Math.floor(Math.random() * 256);
let ipCounter = 0;
const uniqueIp = () => {
  ipCounter += 1;
  return `172.${fileIpOctet}.${runIpSubnet}.${ipCounter & 0xff}`;
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

/**
 * The exact session read the checkout guard issues from every RSC render
 * and Server Action: refresh-free, against one request identity whose
 * forwarded-for header stays fixed for the whole E2E runner.
 */
const readGuardSession = (
  auth: ReturnType<typeof makeTestAuth>,
  headers: Headers
) =>
  auth.api.getSession({
    query: { disableRefresh: true },
    headers,
  });

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
  return verified.headers
    .getSetCookie()
    .find((entry) => entry.includes("session_token="))!
    .split(";")[0]!;
};

const userIdForEmail = async (email: string) => {
  const result = await testDatabase!.pool.query(
    `select id from auth."user" where email = $1`,
    [email]
  );
  return result.rows[0]?.id as string | undefined;
};

describe.skipIf(!testDatabase)(
  "checkout guard session reads against the migrated disposable Postgres",
  () => {
    test("keeps 120 repeated guard-shaped guest reads on one request identity unrate-limited", async () => {
      const auth = makeTestAuth();
      const sharedHeaders = new Headers({
        host: HOST,
        "x-vercel-forwarded-for": uniqueIp(),
      });

      cookieStoreSets.length = 0;
      for (let index = 0; index < 120; index += 1) {
        const session = await readGuardSession(auth, sharedHeaders);
        expect(session).toBeNull();
      }
      expect(cookieStoreSets).toHaveLength(0);
    });

    test("keeps 120 repeated guard-shaped authenticated reads on one request identity unrate-limited and unrefreshed", async () => {
      const sentMagicLinks: { url: string }[] = [];
      const auth = makeTestAuth(sentMagicLinks);
      const email = uniqueEmail("guard-flood");
      const cookie = await signInAndVerify(auth, sentMagicLinks, email);
      const userId = await userIdForEmail(email);
      expect(userId).toBeDefined();

      const before = await testDatabase!.pool.query(
        `select expires_at from auth.session where user_id = $1`,
        [userId]
      );
      const expiresBefore = new Date(before.rows[0]!.expires_at).getTime();

      const sharedHeaders = new Headers({
        host: HOST,
        cookie,
        "x-vercel-forwarded-for": uniqueIp(),
      });

      for (let index = 0; index < 120; index += 1) {
        const session = await readGuardSession(auth, sharedHeaders);
        expect(session?.user.email).toBe(email);
      }

      const after = await testDatabase!.pool.query(
        `select expires_at from auth.session where user_id = $1`,
        [userId]
      );
      expect(new Date(after.rows[0]!.expires_at).getTime()).toBe(expiresBefore);
    });

    test("rate-limits the same request identity only through the mounted browser handler", async () => {
      const auth = makeTestAuth();
      const sharedIp = uniqueIp();

      const statuses: number[] = [];
      let retryAfter: string | null = null;
      for (let index = 0; index < 101; index += 1) {
        const response = await auth.handler(
          new Request(`https://${HOST}/api/auth/get-session`, {
            headers: {
              host: HOST,
              "x-vercel-forwarded-for": sharedIp,
            },
          })
        );
        statuses.push(response.status);
        if (response.status === 429) {
          retryAfter = response.headers.get("x-retry-after");
        }
      }

      expect(statuses.filter((status) => status === 200)).toHaveLength(100);
      expect(statuses[100]).toBe(429);
      expect(retryAfter).toBeTruthy();
    });

    test("decodes an unusable session cookie to a null guest session instead of failing", async () => {
      const sentMagicLinks: { url: string }[] = [];
      const auth = makeTestAuth(sentMagicLinks);
      const email = uniqueEmail("guard-tampered");
      const cookie = await signInAndVerify(auth, sentMagicLinks, email);
      const [name, signedValue] = cookie.split("=");
      const tamperedValue = `${signedValue!.slice(0, -2)}xx`;

      cookieStoreSets.length = 0;
      const session = await readGuardSession(
        auth,
        new Headers({
          host: HOST,
          cookie: `${name}=${tamperedValue}`,
        })
      );

      expect(session).toBeNull();
      expect(cookieStoreSets).toHaveLength(0);
    });
  }
);
