import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, spyOn, test } from "bun:test";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { NetworkError } from "@deskohub/dotypos";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { makeNodePostgresDatabase } from "@/db/database-client";
import {
  WorkspaceDatabaseAdvisoryLock,
  withPostgresAdvisoryLock,
} from "@/db/postgres-advisory-lock";
import {
  authAccount,
  authRateLimit,
  authSession,
  authUser,
  authVerification,
} from "@/db/schema/auth";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { CustomerAccountId } from "../customer-account";
import { CustomerAccountDeletionService } from "../customer-account-deletion";
import { CustomerAccountLinkRepository } from "../customer-account-link.repository";
import { CustomerDotyposAdapter } from "../customer-dotypos-adapter.service";
import type { MagicLinkSendFunction, WorkspaceAuthConfig } from "./auth-server";

const emitWorkspaceLog = mock(() => undefined);

mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: emitWorkspaceLog }),
  },
}));

const { makeWorkspaceAuth } = await import("./auth-server");

const testDatabase = await connectWorkspacePostgresTestDatabase();

const SECRET_V1 = Buffer.alloc(48, 21).toString("base64url");
const SECRET_V2 = Buffer.alloc(48, 22).toString("base64url");
const HOST = "workspace.test";

interface CapturedMagicLink {
  readonly email: string;
  readonly url: string;
  readonly token: string;
}

type TestAuth = ReturnType<typeof makeTestAuth>;

const buildDatabaseAdapter = () =>
  drizzleAdapter(makeNodePostgresDatabase(testDatabase!.pool), {
    provider: "pg",
    schema: {
      user: authUser,
      session: authSession,
      account: authAccount,
      verification: authVerification,
      rateLimit: authRateLimit,
    },
    schemaName: "auth",
  });

const makeTestAuth = (
  options: {
    readonly database?: WorkspaceAuthConfig["database"];
    readonly secrets?: { readonly version: number; readonly value: string }[];
    readonly sentLinks?: CapturedMagicLink[];
    readonly beforeDeleteUser?: (accountId: CustomerAccountId) => Promise<void>;
  } = {}
) => {
  const sendMagicLink: MagicLinkSendFunction = (data) => {
    options.sentLinks?.push(data);
  };
  return makeWorkspaceAuth({
    database: options.database ?? buildDatabaseAdapter(),
    secrets: options.secrets ?? [{ version: 1, value: SECRET_V1 }],
    allowedHosts: [HOST],
    httpsOnly: true,
    sendMagicLink,
    beforeDeleteUser: options.beforeDeleteUser ?? (() => Promise.resolve()),
  });
};

const callHandler = (auth: TestAuth, path: string, init: RequestInit = {}) =>
  auth.handler(
    new Request(`https://${HOST}/api/auth${path}`, {
      ...init,
      headers: {
        origin: `https://${HOST}`,
        "x-vercel-forwarded-for": "192.0.2.1",
        ...((init.headers as Record<string, string>) ?? {}),
      },
    })
  );

const runIpOctet = Math.floor(Math.random() * 200) + 20;
let ipCounter = 0;
const uniqueIp = () => {
  ipCounter += 1;
  return `172.16.${runIpOctet}.${ipCounter}`;
};

const runCustomerPrefix = Math.floor(Math.random() * 900000) + 100000;
let customerCounter = 0;
const uniqueDotyposCustomerId = () => {
  customerCounter += 1;
  return `${runCustomerPrefix}${customerCounter}`;
};

const uniqueEmail = (label: string) =>
  `${label}-${crypto.randomUUID()}@deskohub.test`;

const makeFailingVerificationDatabase = (
  email: string,
  sessionToken: string
) => {
  const baseDatabase = memoryAdapter({
    user: [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
  });

  return (options: Parameters<typeof baseDatabase>[0]) => {
    const adapter = baseDatabase(options);
    return {
      ...adapter,
      create: async (input: Parameters<typeof adapter.create>[0]) => {
        if (input.model === "verification") {
          throw Object.assign(
            new Error("synthetic verification insert failure"),
            {
              query:
                "insert into auth.verification (email, token) values ($1, $2)",
              params: [email, sessionToken],
            }
          );
        }
        return adapter.create(input);
      },
    };
  };
};

const signInForMagicLink = (
  auth: TestAuth,
  email: string,
  callbackURL?: string,
  ip: string = uniqueIp()
) =>
  callHandler(auth, "/sign-in/magic-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": ip,
    },
    body: JSON.stringify(callbackURL ? { email, callbackURL } : { email }),
  });

const getSessionCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.includes("session_token="));

const cookieJar = (setCookie: string) => setCookie.split(";")[0]!;

const userIdForEmail = async (email: string) => {
  const result = await testDatabase!.pool.query(
    `select id from auth."user" where email = $1`,
    [email]
  );
  return (result.rows[0]?.id as string | undefined) ?? undefined;
};

const linkAccount = async (userId: string, dotyposCustomerId: string) => {
  await testDatabase!.pool.query(
    `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)`,
    [userId, dotyposCustomerId]
  );
};

const verifyLinkPath = (link: CapturedMagicLink) =>
  link.url.slice(`https://${HOST}/api/auth`.length);

const verifyMagicLink = (
  auth: TestAuth,
  link: CapturedMagicLink,
  ip: string = uniqueIp()
) =>
  callHandler(auth, verifyLinkPath(link), {
    headers: { "x-vercel-forwarded-for": ip },
  });

const makeTestDeletionLayers = (
  expireCustomer: () => Effect.Effect<void, unknown>
) =>
  CustomerAccountDeletionService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAccountLinkRepository.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: testDatabase!.db })
              ),
              WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool)
            )
          )
        ),
        Layer.mock(CustomerDotyposAdapter, { expireCustomer })
      )
    )
  );

const runTestDeletion = (
  layers: Layer.Layer<CustomerAccountDeletionService>,
  accountId: CustomerAccountId
) =>
  Effect.runPromise(
    Effect.flatMap(CustomerAccountDeletionService, (service) =>
      service.requestDeletion(accountId)
    ).pipe(Effect.provide(layers))
  );

test("reports auth handler failures without logging provider data", async () => {
  const email = uniqueEmail("verification-failure");
  const sessionToken = `synthetic-session-token-${crypto.randomUUID()}`;
  const auth = makeTestAuth({
    database: makeFailingVerificationDatabase(email, sessionToken),
  });
  const consoleError = spyOn(console, "error").mockImplementation(
    () => undefined
  );
  const consoleLog = spyOn(console, "log").mockImplementation(() => undefined);
  const consoleWarn = spyOn(console, "warn").mockImplementation(
    () => undefined
  );

  emitWorkspaceLog.mockClear();

  try {
    const authContext = await auth.$context;
    authContext.logger.error("synthetic internal provider failure", {
      email,
      sessionToken,
    });

    const response = await signInForMagicLink(auth, email);
    const body = await response.text();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const captured = JSON.stringify(
      [
        ...consoleError.mock.calls,
        ...consoleLog.mock.calls,
        ...consoleWarn.mock.calls,
        ...emitWorkspaceLog.mock.calls,
      ],
      (_key, value) =>
        value instanceof Error
          ? { ...value, message: value.message, name: value.name }
          : value
    );

    expect(response.status).toBe(500);
    expect(body).toBe(JSON.stringify({ message: "Internal Server Error" }));
    expect(captured).not.toContain(email);
    expect(captured).not.toContain(sessionToken);
    expect(captured).not.toContain("synthetic verification insert failure");
    expect(captured).not.toContain("synthetic internal provider failure");
    expect(captured).not.toContain("/api/auth/sign-in/magic-link");
    expect(captured).not.toContain("insert into auth.verification");
    expect(captured).not.toContain("query");
    expect(captured).not.toContain("params");
    expect(emitWorkspaceLog).toHaveBeenCalledTimes(1);
    expect(emitWorkspaceLog.mock.calls[0]?.[0]).toMatchObject({
      attributes: {
        boundary: "route",
        operation: "account.auth.handler",
      },
      body: ["Better Auth request failed.", '{"code":"account.auth.handler"}'],
    });
  } finally {
    consoleError.mockRestore();
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
  }
});

describe.skipIf(!testDatabase)(
  "Better Auth handler on the migrated disposable Postgres",
  () => {
    test("answers generic requests and keeps the sign-in response identical", async () => {
      const auth = makeTestAuth();

      const known = await signInForMagicLink(auth, uniqueEmail("known"));
      const unknown = await signInForMagicLink(auth, uniqueEmail("unknown"));

      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(await known.json()).toEqual({ status: true });
      expect(await unknown.json()).toEqual({ status: true });

      const notFound = await callHandler(auth, "/does-not-exist");
      expect(notFound.status).toBe(404);
    });

    test("rejects magic-link profile fields before creating verification or sending email", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const email = uniqueEmail("profile-fields");
      const rawProfileSecret = `profile-secret-${crypto.randomUUID()}`;

      emitWorkspaceLog.mockClear();
      const response = await callHandler(auth, "/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          name: rawProfileSecret,
          image: rawProfileSecret,
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(rawProfileSecret);
      expect(sentLinks).toHaveLength(0);
      expect(emitWorkspaceLog).not.toHaveBeenCalled();

      const verification = await testDatabase!.pool.query(
        `select id from auth.verification where value like $1`,
        [`%${email}%`]
      );
      expect(verification.rows).toHaveLength(0);

      const user = await testDatabase!.pool.query(
        `select id from auth."user" where email = $1`,
        [email]
      );
      expect(user.rows).toHaveLength(0);
    });

    test("keeps normal magic-link users at the auth placeholders", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const email = uniqueEmail("placeholders");

      const requested = await signInForMagicLink(auth, email, "/en-US/account");
      expect(requested.status).toBe(200);

      const verified = await verifyMagicLink(auth, sentLinks[0]!);
      expect(verified.status).toBe(302);

      const user = await testDatabase!.pool.query(
        `select name, image from auth."user" where email = $1`,
        [email]
      );
      expect(user.rows).toEqual([{ name: "", image: null }]);
    });

    test("disables public user updates and rejects direct profile writes", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const email = uniqueEmail("update-user");
      const rawProfileSecret = `update-secret-${crypto.randomUUID()}`;

      await signInForMagicLink(auth, email);
      const verified = await verifyMagicLink(auth, sentLinks[0]!);
      const cookie = cookieJar(getSessionCookie(verified)!);

      const publicUpdate = await callHandler(auth, "/update-user", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          name: rawProfileSecret,
          image: rawProfileSecret,
        }),
      });
      expect(publicUpdate.status).toBe(404);

      await expect(
        auth.api.updateUser({
          body: { name: rawProfileSecret, image: rawProfileSecret },
          headers: new Headers({
            origin: `https://${HOST}`,
            host: HOST,
            "content-type": "application/json",
            cookie,
          }),
        })
      ).rejects.toMatchObject({ status: "BAD_REQUEST", statusCode: 400 });

      const user = await testDatabase!.pool.query(
        `select name, image from auth."user" where email = $1`,
        [email]
      );
      expect(user.rows).toEqual([{ name: "", image: null }]);
    });

    test("stores only hashed verification identifiers", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const email = uniqueEmail("hashed");

      await signInForMagicLink(auth, email);

      const rawToken = sentLinks[0]!.token;
      expect(rawToken).toBeTruthy();

      const plaintext = await testDatabase!.pool.query(
        `select identifier from auth.verification where identifier = $1`,
        [rawToken]
      );
      expect(plaintext.rows).toHaveLength(0);

      const stored = await testDatabase!.pool.query(
        `select identifier from auth.verification where identifier <> $1`,
        [rawToken]
      );
      expect(stored.rows.length).toBeGreaterThan(0);
      expect(stored.rows[0]!.identifier).not.toBe(rawToken);
    });

    test("consumes a link exactly once under concurrency and rejects replay", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const email = uniqueEmail("once");

      await signInForMagicLink(auth, email, "/en-US/account");
      const link = sentLinks[0]!;

      const [first, second] = await Promise.all([
        verifyMagicLink(auth, link),
        verifyMagicLink(auth, link),
      ]);

      const withSession = [first, second].filter((r) => getSessionCookie(r));
      expect(withSession).toHaveLength(1);

      const successful = withSession[0]!;
      expect(successful.status).toBe(302);
      expect(successful.headers.get("location")).toBe(
        `https://${HOST}/en-US/account`
      );

      const userId = await userIdForEmail(email);
      expect(userId).toBeTruthy();
      const sessions = await testDatabase!.pool.query(
        `select id from auth.session where user_id = $1`,
        [userId]
      );
      expect(sessions.rows).toHaveLength(1);

      const replay = await verifyMagicLink(auth, link);
      expect(getSessionCookie(replay)).toBeUndefined();
      expect(replay.headers.get("location") ?? "").toContain("error=");
    });

    test("rejects expired links", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const email = uniqueEmail("expired");

      await signInForMagicLink(auth, email);
      const link = sentLinks[0]!;

      await testDatabase!.pool.query(
        `update auth.verification set expires_at = now() - interval '20 minutes' where value like $1`,
        [`%${email}%`]
      );

      const response = await verifyMagicLink(auth, link);

      expect(getSessionCookie(response)).toBeUndefined();
      expect(response.headers.get("location") ?? "").toContain("error=");
    });

    test("rate limits magic-link requests per IP through the shared database", async () => {
      const authA = makeTestAuth();
      const authB = makeTestAuth();
      const ip = uniqueIp();

      for (let index = 0; index < 5; index += 1) {
        const response = await signInForMagicLink(
          index % 2 === 0 ? authA : authB,
          uniqueEmail("rate"),
          undefined,
          ip
        );
        expect(response.status).toBe(200);
      }

      const blockedOnSecondInstance = await signInForMagicLink(
        authB,
        uniqueEmail("rate"),
        undefined,
        ip
      );
      expect(blockedOnSecondInstance.status).toBe(429);
      expect(blockedOnSecondInstance.headers.get("x-retry-after")).toBeTruthy();

      const rateRows = await testDatabase!.pool.query(
        `select key from auth.rate_limit where key = $1`,
        [`${ip}|/sign-in/magic-link`]
      );
      expect(rateRows.rows).toHaveLength(1);

      const otherIp = await signInForMagicLink(
        authA,
        uniqueEmail("rate"),
        undefined,
        uniqueIp()
      );
      expect(otherIp.status).toBe(200);
    });

    test("rejects disallowed origins on cookie-bearing mutations and disallowed absolute callbacks", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const email = uniqueEmail("origin");

      await signInForMagicLink(auth, email);
      const verifyResponse = await verifyMagicLink(auth, sentLinks[0]!);
      const cookie = cookieJar(getSessionCookie(verifyResponse)!);

      emitWorkspaceLog.mockClear();
      const evilOrigin = await auth.handler(
        new Request(`https://${HOST}/api/auth/sign-out`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://evil.example",
            cookie,
          },
          body: "{}",
        })
      );
      expect(evilOrigin.status).toBe(403);

      const capturing = makeTestAuth({ sentLinks });
      const evilCallbackSignIn = await signInForMagicLink(
        capturing,
        uniqueEmail("callback"),
        "https://evil.example/steal"
      );
      expect(evilCallbackSignIn.status).toBe(403);

      const evilCallbackVerify = await callHandler(
        capturing,
        `/magic-link/verify?token=${sentLinks[0]!.token}&callbackURL=${encodeURIComponent("https://evil.example/steal")}`
      );
      expect(evilCallbackVerify.status).toBe(403);
      expect(emitWorkspaceLog).not.toHaveBeenCalled();
    });

    test("sets secure host-only cookies with lax same-site", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });

      await signInForMagicLink(auth, uniqueEmail("cookie"));
      const response = await verifyMagicLink(auth, sentLinks[0]!);

      const setCookie = getSessionCookie(response);
      expect(setCookie).toBeTruthy();
      expect(setCookie).toMatch(/^__/);
      expect(setCookie).toMatch(/Secure/i);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      expect(setCookie).toMatch(/Path=\//);
      expect(setCookie).not.toMatch(/Domain=/);
    });

    test("resolves authoritative sessions and drops revoked rows immediately", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const email = uniqueEmail("authoritative");

      await signInForMagicLink(auth, email);
      const verifyResponse = await verifyMagicLink(auth, sentLinks[0]!);
      const cookie = cookieJar(getSessionCookie(verifyResponse)!);

      const session = await callHandler(auth, "/get-session", {
        headers: { cookie },
      });
      expect(session.status).toBe(200);
      const sessionBody = (await session.json()) as {
        user: { email: string; emailVerified: boolean };
      };
      expect(sessionBody.user.email).toBe(email);
      expect(sessionBody.user.emailVerified).toBe(true);

      await testDatabase!.pool.query(
        `delete from auth.session where user_id = $1`,
        [await userIdForEmail(email)]
      );

      const revoked = await callHandler(auth, "/get-session", {
        headers: { cookie },
      });
      expect(await revoked.json()).toBeNull();
    });

    test("rolls the session expiry forward after the refresh age", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const email = uniqueEmail("rolling");

      await signInForMagicLink(auth, email);
      const verifyResponse = await verifyMagicLink(auth, sentLinks[0]!);
      const cookie = cookieJar(getSessionCookie(verifyResponse)!);
      const userId = (await userIdForEmail(email))!;

      const before = await testDatabase!.pool.query(
        `select expires_at from auth.session where user_id = $1`,
        [userId]
      );
      const expiresBefore = new Date(before.rows[0]!.expires_at).getTime();

      await testDatabase!.pool.query(
        `update auth.session set expires_at = now() + interval '28 days' where user_id = $1`,
        [userId]
      );

      const refreshed = await callHandler(auth, "/get-session", {
        headers: { cookie },
      });
      expect(refreshed.status).toBe(200);

      const after = await testDatabase!.pool.query(
        `select expires_at from auth.session where user_id = $1`,
        [userId]
      );
      const expiresAfter = new Date(after.rows[0]!.expires_at).getTime();

      expect(expiresAfter).toBeGreaterThan(expiresBefore);
    });

    test("logout revokes only the current session", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const email = uniqueEmail("logout");

      await signInForMagicLink(auth, email);
      const first = await verifyMagicLink(auth, sentLinks[0]!);
      const firstCookie = cookieJar(getSessionCookie(first)!);

      await signInForMagicLink(auth, email);
      const second = await verifyMagicLink(auth, sentLinks[1]!);
      const secondCookie = cookieJar(getSessionCookie(second)!);

      const signOut = await callHandler(auth, "/sign-out", {
        method: "POST",
        headers: { cookie: firstCookie, "content-type": "application/json" },
        body: "{}",
      });
      expect(signOut.status).toBe(200);

      const revokedSession = await callHandler(auth, "/get-session", {
        headers: { cookie: firstCookie },
      });
      expect(await revokedSession.json()).toBeNull();

      const survivingSession = await callHandler(auth, "/get-session", {
        headers: { cookie: secondCookie },
      });
      expect(survivingSession.status).toBe(200);
    });

    test("forces logout on every browser session when the current secret rotates", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const before = makeTestAuth({ sentLinks });
      const email = uniqueEmail("rotation");

      await signInForMagicLink(before, email);
      const verifyResponse = await verifyMagicLink(before, sentLinks[0]!);
      const cookie = cookieJar(getSessionCookie(verifyResponse)!);

      expect(
        await (
          await callHandler(before, "/get-session", { headers: { cookie } })
        ).json()
      ).not.toBeNull();

      const after = makeTestAuth({
        secrets: [
          { version: 2, value: SECRET_V2 },
          { version: 1, value: SECRET_V1 },
        ],
      });
      const rotated = await callHandler(after, "/get-session", {
        headers: { cookie },
      });
      expect(await rotated.json()).toBeNull();
    });

    test("expires the linked Dotypos profile and cascades identity removal on fresh deletion", async () => {
      const calls: string[] = [];
      const deletionLayers = makeTestDeletionLayers(() => {
        calls.push("expire");
        return Effect.void;
      });
      const beforeDeleteUser = (accountId: CustomerAccountId) =>
        runTestDeletion(deletionLayers, accountId);

      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks, beforeDeleteUser });
      const email = uniqueEmail("delete");

      await signInForMagicLink(auth, email);
      const verifyResponse = await verifyMagicLink(auth, sentLinks[0]!);
      const cookie = cookieJar(getSessionCookie(verifyResponse)!);
      const userId = (await userIdForEmail(email))!;
      await linkAccount(userId, uniqueDotyposCustomerId());

      const deleted = await callHandler(auth, "/delete-user", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      });

      expect(deleted.status).toBe(200);
      expect(calls).toEqual(["expire"]);

      const user = await testDatabase!.pool.query(
        `select id from auth."user" where id = $1`,
        [userId]
      );
      expect(user.rows).toHaveLength(0);

      const link = await testDatabase!.pool.query(
        `select * from customer_account_links where customer_account_id = $1`,
        [userId]
      );
      expect(link.rows).toHaveLength(0);

      const sessions = await testDatabase!.pool.query(
        `select id from auth.session where user_id = $1`,
        [userId]
      );
      expect(sessions.rows).toHaveLength(0);
    });

    test("keeps the account, link, and durable marker when deletion fails retryably", async () => {
      const deletionLayers = makeTestDeletionLayers(() =>
        Effect.fail(new NetworkError({ message: "provider unreachable" }))
      );
      const beforeDeleteUser = (accountId: CustomerAccountId) =>
        runTestDeletion(deletionLayers, accountId);

      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks, beforeDeleteUser });
      const email = uniqueEmail("retry");

      await signInForMagicLink(auth, email);
      const verifyResponse = await verifyMagicLink(auth, sentLinks[0]!);
      const cookie = cookieJar(getSessionCookie(verifyResponse)!);
      const userId = (await userIdForEmail(email))!;
      await linkAccount(userId, uniqueDotyposCustomerId());

      const failed = await callHandler(auth, "/delete-user", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      });
      expect(failed.status).toBe(500);

      const user = await testDatabase!.pool.query(
        `select deletion_requested_at from auth."user" where id = $1`,
        [userId]
      );
      expect(user.rows).toHaveLength(1);
      expect(user.rows[0]!.deletion_requested_at).not.toBeNull();

      const link = await testDatabase!.pool.query(
        `select * from customer_account_links where customer_account_id = $1`,
        [userId]
      );
      expect(link.rows).toHaveLength(1);
    });

    test("rejects stale sessions before the deletion hook runs", async () => {
      let hookCalls = 0;
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        beforeDeleteUser: () => {
          hookCalls += 1;
          return Promise.resolve();
        },
      });
      const email = uniqueEmail("stale");

      await signInForMagicLink(auth, email);
      const verifyResponse = await verifyMagicLink(auth, sentLinks[0]!);
      const cookie = cookieJar(getSessionCookie(verifyResponse)!);
      const userId = (await userIdForEmail(email))!;

      await testDatabase!.pool.query(
        `update auth.session set created_at = now() - interval '20 minutes' where user_id = $1`,
        [userId]
      );

      const stale = await callHandler(auth, "/delete-user", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      });

      expect(stale.status).toBe(400);
      expect(hookCalls).toBe(0);

      const user = await testDatabase!.pool.query(
        `select id from auth."user" where id = $1`,
        [userId]
      );
      expect(user.rows).toHaveLength(1);
    });

    test("serializes deletion behind the account advisory lock", async () => {
      const deletionLayers = makeTestDeletionLayers(() => Effect.void);
      const beforeDeleteUser = (accountId: CustomerAccountId) =>
        runTestDeletion(deletionLayers, accountId);

      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks, beforeDeleteUser });
      const email = uniqueEmail("locked");

      await signInForMagicLink(auth, email);
      const verifyResponse = await verifyMagicLink(auth, sentLinks[0]!);
      const cookie = cookieJar(getSessionCookie(verifyResponse)!);
      const userId = (await userIdForEmail(email))!;
      await linkAccount(userId, uniqueDotyposCustomerId());

      const lockKey: [string, string] = ["customer-account", userId];

      await Effect.runPromise(
        Effect.gen(function* () {
          const lockReleased = yield* Deferred.make<void>();

          const holdFiber = yield* Effect.forkChild(
            withPostgresAdvisoryLock(
              testDatabase!.pool,
              lockKey,
              Deferred.await(lockReleased).pipe(Effect.orDie)
            ).pipe(Effect.orDie)
          );

          yield* Effect.sleep("200 millis");

          const deletion = callHandler(auth, "/delete-user", {
            method: "POST",
            headers: { cookie, "content-type": "application/json" },
            body: "{}",
          }).then((response) => response.status);

          yield* Effect.sleep("400 millis");

          const stillThere = yield* Effect.promise(() =>
            testDatabase!.pool.query(
              `select id from auth."user" where id = $1`,
              [userId]
            )
          );
          expect(stillThere.rows).toHaveLength(1);

          yield* Deferred.succeed(lockReleased, undefined);
          expect(yield* Effect.promise(() => deletion)).toBe(200);

          yield* Fiber.join(holdFiber);
        })
      );

      const user = await testDatabase!.pool.query(
        `select id from auth."user" where id = $1`,
        [userId]
      );
      expect(user.rows).toHaveLength(0);
    });
  }
);
