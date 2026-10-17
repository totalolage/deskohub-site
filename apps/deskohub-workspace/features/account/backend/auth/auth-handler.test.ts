import "@/shared/testing/workspace-test-env";

import { describe, expect, spyOn, test } from "bun:test";
import { NetworkError } from "@deskohub/dotypos";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  WorkspaceDatabaseAdvisoryLock,
  withPostgresAdvisoryLock,
} from "@/db/postgres-advisory-lock";
import type { CustomerAccountId } from "../../customer-account";
import { CustomerAccountRepository } from "../customer-account.repository";
import { CustomerAccountDeletionService } from "../customer-account-deletion";
import { CustomerAccountLinkRepository } from "../customer-account-link.repository";
import { waitForAccountAdvisoryLockWait } from "../customer-account-lock.test-utils";
import {
  CustomerAvatarProviderError,
  CustomerAvatarService,
  type CustomerAvatarUnavailableError,
} from "../customer-avatar.service";
import { CustomerDotyposAdapter } from "../customer-dotypos-adapter.service";
import {
  type CapturedMagicLink,
  callHandler,
  captureFailure,
  cookieJar,
  emitWorkspaceLog,
  getSessionCookie,
  HOST,
  linkAccount,
  makeMemoryTestAuth,
  makeTestAuth,
  SECRET_V1,
  SECRET_V2,
  signInForMagicLink,
  type TestAuth,
  testDatabase,
  uniqueDotyposCustomerId,
  uniqueEmail,
  uniqueIp,
  userIdForEmail,
  verifyMagicLink,
} from "./auth-handler.test-utils";

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

const makeTestDeletionLayers = (
  expireCustomer: () => Effect.Effect<void, unknown>,
  destroyAvatar: () => Effect.Effect<
    void,
    CustomerAvatarProviderError | CustomerAvatarUnavailableError
  > = () => Effect.void
) =>
  CustomerAccountDeletionService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mergeAll(
          CustomerAccountLinkRepository.Default,
          CustomerAccountRepository.Default
        ).pipe(
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
        Layer.mock(CustomerDotyposAdapter, { expireCustomer }),
        Layer.mock(CustomerAvatarService, { destroy: destroyAvatar })
      )
    )
  );

const runTestDeletion = (
  layers: Layer.Layer<CustomerAccountDeletionService>,
  accountId: CustomerAccountId
) =>
  Effect.flatMap(CustomerAccountDeletionService, (service) =>
    service.requestDeletion(accountId)
  ).pipe(Effect.provide(layers));

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

const sha256Base64Url = async (value: string) =>
  Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  ).toString("base64url");

test("stores neither the emailed magic-link token nor its plain digest", async () => {
  const sentLinks: CapturedMagicLink[] = [];
  const { auth, store } = makeMemoryTestAuth({ sentLinks });

  await signInForMagicLink(auth, uniqueEmail("token-storage"));

  const rawToken = sentLinks[0]!.token;
  const stored = store.verification.map(({ identifier }) => identifier);
  expect(stored).toHaveLength(1);
  // The token is hashed before the verification identifier is hashed again,
  // so neither the emailed token nor a single digest of it is stored.
  expect(stored).not.toContain(rawToken);
  expect(stored).not.toContain(await sha256Base64Url(rawToken));
});

const postJson = (
  auth: TestAuth,
  path: string,
  body: Readonly<Record<string, string>>
) =>
  callHandler(auth, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("rejects password sign-up and sign-in", async () => {
  const { auth, store } = makeMemoryTestAuth();
  const password = "synthetic-password-1234";
  const signUpEmail = uniqueEmail("password-sign-up");

  const signUp = await postJson(auth, "/sign-up/email", {
    email: signUpEmail,
    password,
    name: "Synthetic Customer",
  });
  expect(signUp.ok).toBe(false);
  expect(store.user).toHaveLength(0);

  // A password account created by a password-enabled instance on the same
  // store must still be refused by the Workspace instance.
  const email = uniqueEmail("password-sign-in");
  await betterAuth({
    database: memoryAdapter(store),
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
    secret: SECRET_V1,
  }).api.signUpEmail({
    body: { email, password, name: "Synthetic Customer" },
  });
  store.session.length = 0;

  const signIn = await postJson(auth, "/sign-in/email", { email, password });
  expect(signIn.ok).toBe(false);
  expect(getSessionCookie(signIn)).toBeUndefined();
  expect(store.session).toHaveLength(0);
});

test("reads the session and revokes it on sign-out", async () => {
  const sentLinks: CapturedMagicLink[] = [];
  const { auth } = makeMemoryTestAuth({ sentLinks });
  const email = uniqueEmail("session-sign-out");

  await signInForMagicLink(auth, email);
  const verified = await verifyMagicLink(auth, sentLinks[0]!);
  const cookie = cookieJar(getSessionCookie(verified)!);

  const session = await callHandler(auth, "/get-session", {
    headers: { cookie },
  });
  expect(session.status).toBe(200);
  expect((await session.json()).user.email).toBe(email);

  const signOut = await callHandler(auth, "/sign-out", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: "{}",
  });
  expect(signOut.status).toBe(200);

  const revoked = await callHandler(auth, "/get-session", {
    headers: { cookie },
  });
  expect(await revoked.json()).toBeNull();
});

describe.skipIf(!testDatabase)(
  "Better Auth handler on the migrated disposable Postgres",
  () => {
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

    const localeOf = async (accountId: string) =>
      (
        await testDatabase!.pool.query<{ locale: string | null }>(
          `select locale from auth."user" where id = $1`,
          [accountId]
        )
      ).rows[0]?.locale;

    test("sets the locale preference from the initiating site locale in the account-creation insert", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });

      const createdLocaleFor = async (email: string) => {
        const userId = await userIdForEmail(email);
        expect(userId).toBeTruthy();
        return localeOf(userId!);
      };

      const emailEn = uniqueEmail("seed-en");
      await signInForMagicLink(auth, emailEn, "/en-US/account");
      await verifyMagicLink(auth, sentLinks[0]!);
      expect(await createdLocaleFor(emailEn)).toBe("en-US");

      const emailCs = uniqueEmail("seed-cs");
      await signInForMagicLink(auth, emailCs, "/cs-CZ/account");
      await verifyMagicLink(auth, sentLinks[1]!);
      expect(await createdLocaleFor(emailCs)).toBe("cs-CZ");

      const emailDefault = uniqueEmail("seed-default");
      await signInForMagicLink(auth, emailDefault);
      await verifyMagicLink(auth, sentLinks[2]!);
      expect(await createdLocaleFor(emailDefault)).toBe("en-US");
    });

    test("keeps the creation locale when a later sign-in carries another one", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const email = uniqueEmail("seed-kept");

      await signInForMagicLink(auth, email, "/cs-CZ/account");
      await verifyMagicLink(auth, sentLinks[0]!);
      await signInForMagicLink(auth, email, "/en-US/account");
      const second = await verifyMagicLink(auth, sentLinks[1]!);

      expect(getSessionCookie(second)).toBeTruthy();
      expect(await localeOf((await userIdForEmail(email))!)).toBe("cs-CZ");
    });

    const insertLegacyAccount = async (email: string) => {
      const id = crypto.randomUUID();
      await testDatabase!.pool.query(
        `insert into auth."user" (id, name, email, email_verified) values ($1, '', $2, true)`,
        [id, email]
      );
      return id;
    };

    test("signs a legacy account in and captures its first sign-in locale without overwriting it later", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const email = uniqueEmail("legacy-capture");
      const accountId = await insertLegacyAccount(email);

      await signInForMagicLink(auth, email, "/cs-CZ/account");
      const first = await verifyMagicLink(auth, sentLinks[0]!);
      expect(getSessionCookie(first)).toBeTruthy();
      expect(await localeOf(accountId)).toBe("cs-CZ");

      await signInForMagicLink(auth, email, "/en-US/account");
      const second = await verifyMagicLink(auth, sentLinks[1]!);
      expect(getSessionCookie(second)).toBeTruthy();
      expect(await localeOf(accountId)).toBe("cs-CZ");
    });

    test("keeps a legacy account without a preference when the sign-in callback carries no locale", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const email = uniqueEmail("legacy-no-locale");
      const accountId = await insertLegacyAccount(email);

      await signInForMagicLink(auth, email);
      const verified = await verifyMagicLink(auth, sentLinks[0]!);

      expect(getSessionCookie(verified)).toBeTruthy();
      expect(await localeOf(accountId)).toBeNull();
    });

    test("signs a legacy account in when the preference capture fails", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        captureAccountLocalePreference: () => Effect.fail(captureFailure()),
      });
      const email = uniqueEmail("legacy-capture-failure");
      const accountId = await insertLegacyAccount(email);

      emitWorkspaceLog.mockClear();
      await signInForMagicLink(auth, email, "/cs-CZ/account");
      const verified = await verifyMagicLink(auth, sentLinks[0]!);

      expect(verified.status).toBe(302);
      expect(getSessionCookie(verified)).toBeTruthy();
      expect(await localeOf(accountId)).toBeNull();
      const logs = JSON.stringify(emitWorkspaceLog.mock.calls);
      expect(logs).toContain("account-locale-preference.capture-failed");
      expect(logs).not.toContain("synthetic constraint violation");
      expect(logs).not.toContain(email);
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

    test("keeps the auth identity and link when avatar deletion has an unknown provider outcome", async () => {
      const deletionLayers = makeTestDeletionLayers(
        () => Effect.void,
        () => Effect.fail(new CustomerAvatarProviderError({}))
      );
      const beforeDeleteUser = (accountId: CustomerAccountId) =>
        runTestDeletion(deletionLayers, accountId);

      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks, beforeDeleteUser });
      const email = uniqueEmail("avatar-delete-retry");

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
        beforeDeleteUser: () =>
          Effect.sync(() => {
            hookCalls += 1;
          }),
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
          const lockHeld = yield* Deferred.make<void>();
          const lockReleased = yield* Deferred.make<void>();

          const holdFiber = yield* Effect.forkChild(
            withPostgresAdvisoryLock(
              testDatabase!.pool,
              lockKey,
              Deferred.succeed(lockHeld, undefined).pipe(
                Effect.andThen(Deferred.await(lockReleased)),
                Effect.orDie
              )
            ).pipe(Effect.orDie)
          );
          yield* Deferred.await(lockHeld);

          const deletion = callHandler(auth, "/delete-user", {
            method: "POST",
            headers: { cookie, "content-type": "application/json" },
            body: "{}",
          }).then((response) => response.status);

          yield* Effect.promise(() =>
            waitForAccountAdvisoryLockWait(testDatabase!.pool, userId)
          );

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
