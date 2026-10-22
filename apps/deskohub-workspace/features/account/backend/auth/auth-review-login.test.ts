import { describe, expect, spyOn, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Effect } from "effect";
import {
  type CapturedMagicLink,
  callHandler,
  cookieJar,
  emitWorkspaceLog,
  getSessionCookie,
  makeMemoryAuthStore,
  makeTestAuth,
  SECRET_V1,
  signInForMagicLink,
  type TestAuth,
  type TestAuthOptions,
  testDatabase,
  uniqueEmail,
  uniqueIp,
  userIdForEmail,
  verifyMagicLink,
} from "./auth-handler.test-utils";
import type { ReviewAccountCredential } from "./review-account-credentials";

const generatedPassword = () => `review-${crypto.randomUUID()}`;

const reviewLogin = (label: string): ReviewAccountCredential => ({
  email: uniqueEmail(label),
  password: generatedPassword(),
});

const postJson = (
  auth: TestAuth,
  path: string,
  body: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = {}
) =>
  callHandler(auth, path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": uniqueIp(),
      ...headers,
    },
    body: JSON.stringify(body),
  });

const signInWithPassword = (
  auth: TestAuth,
  { email, password }: ReviewAccountCredential
) =>
  postJson(auth, "/sign-in/email", {
    email,
    password,
    callbackURL: "/en-US/auth/callback",
  });

const errorCode = async (response: Response) =>
  ((await response.json()) as { code?: string }).code;

/** The review-account marker of a memory-backed instance. */
const makeMemoryReviewAccounts = () => {
  const marked = new Set<string>();
  return {
    marked,
    options: {
      isReviewAccount: (accountId) => Effect.sync(() => marked.has(accountId)),
      registerReviewAccount: (accountId) =>
        Effect.sync(() => {
          marked.add(accountId);
        }),
    } satisfies Pick<
      TestAuthOptions,
      "isReviewAccount" | "registerReviewAccount"
    >,
  };
};

type MemoryStore = ReturnType<typeof makeMemoryAuthStore>;

const makeReviewAuth = (
  logins: readonly ReviewAccountCredential[],
  {
    store = makeMemoryAuthStore(),
    reviewAccounts = makeMemoryReviewAccounts(),
    database,
    ...options
  }: Omit<TestAuthOptions, "database" | "reviewAccountCredentials"> & {
    readonly store?: MemoryStore;
    readonly reviewAccounts?: ReturnType<typeof makeMemoryReviewAccounts>;
    readonly database?: TestAuthOptions["database"];
  } = {}
) => ({
  auth: makeTestAuth({
    ...options,
    ...reviewAccounts.options,
    database: database ?? memoryAdapter(store),
    reviewAccountCredentials: logins,
  }),
  store,
  reviewAccounts,
});

const credentialAccounts = (store: MemoryStore) =>
  store.account.filter((account) => account.providerId === "credential");

describe("review login password sign-in", () => {
  test("signs an allowlisted review login in with a verified review-account session", async () => {
    const login = reviewLogin("review-sign-in");
    const { auth, store, reviewAccounts } = makeReviewAuth([login]);

    const response = await signInWithPassword(auth, login);

    expect(response.status).toBe(200);
    // The page continues through its callback itself.
    expect(((await response.json()) as { redirect: boolean }).redirect).toBe(
      false
    );
    const cookie = cookieJar(getSessionCookie(response)!);
    const session = await callHandler(auth, "/get-session", {
      headers: { cookie },
    });
    const { user } = (await session.json()) as {
      user: { id: string; email: string; emailVerified: boolean };
    };
    expect(user.email).toBe(login.email);
    expect(user.emailVerified).toBe(true);
    expect(reviewAccounts.marked.has(user.id)).toBe(true);
    const [credential] = credentialAccounts(store);
    expect(credential?.userId).toBe(user.id);
    expect(credential?.accountId).toBe(user.id);
    expect(credential?.password).not.toContain(login.password);
  });

  test("refuses every other address before any lookup, even with a password on record", async () => {
    const login = reviewLogin("review-allowlisted");
    const { auth, store } = makeReviewAuth([login]);
    const customer = reviewLogin("review-customer-password");
    // A password login written by a password-enabled instance on the same
    // store, as a misconfiguration or an older release could leave.
    await betterAuth({
      database: memoryAdapter(store),
      emailAndPassword: { enabled: true },
      logger: { disabled: true },
      secret: SECRET_V1,
    }).api.signUpEmail({
      body: { ...customer, name: "Synthetic Customer" },
    });
    store.session.length = 0;
    const findUserByEmail = spyOn(
      (await auth.$context).internalAdapter,
      "findUserByEmail"
    );

    for (const attempt of [customer, reviewLogin("review-unknown")]) {
      const response = await signInWithPassword(auth, attempt);
      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe("INVALID_EMAIL_OR_PASSWORD");
      expect(getSessionCookie(response)).toBeUndefined();
    }
    expect(findUserByEmail).not.toHaveBeenCalled();
    expect(store.session).toHaveLength(0);
  });

  test("refuses a wrong password for a review login", async () => {
    const login = reviewLogin("review-wrong-password");
    const { auth, store } = makeReviewAuth([login]);

    const response = await signInWithPassword(auth, {
      ...login,
      password: generatedPassword(),
    });

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(store.session).toHaveLength(0);
    // A wrong password provisions nothing.
    expect(store.user).toHaveLength(0);
  });

  test("refuses sign-up and every password management route", async () => {
    const login = reviewLogin("review-password-routes");
    const { auth, store } = makeReviewAuth([login]);

    const signUp = await postJson(auth, "/sign-up/email", {
      ...login,
      name: "Synthetic Reviewer",
    });
    expect(signUp.status).toBe(404);
    expect(store.user).toHaveLength(0);

    const cookie = cookieJar(
      getSessionCookie(await signInWithPassword(auth, login))!
    );
    for (const path of [
      "/request-password-reset",
      "/reset-password",
      "/change-password",
      "/verify-password",
      "/change-email",
      "/unlink-account",
    ]) {
      const response = await postJson(
        auth,
        path,
        {
          email: login.email,
          newEmail: uniqueEmail("review-new-address"),
          password: login.password,
          currentPassword: login.password,
          newPassword: generatedPassword(),
          token: "synthetic-token",
          providerId: "credential",
        },
        { cookie }
      );
      expect(`${path} ${response.status}`).toBe(`${path} 404`);
    }
    for (const path of ["/reset-password/synthetic-token", "/list-accounts"]) {
      const response = await callHandler(auth, path, {
        headers: { cookie, "x-vercel-forwarded-for": uniqueIp() },
      });
      expect(`${path} ${response.status}`).toBe(`${path} 404`);
    }
    expect(store.user).toHaveLength(1);
    expect(credentialAccounts(store)).toHaveLength(1);
  });

  test("provisions once: a repeat sign-in writes nothing new", async () => {
    const login = reviewLogin("review-repeat");
    const { auth, store, reviewAccounts } = makeReviewAuth([login]);

    expect((await signInWithPassword(auth, login)).status).toBe(200);
    const [first] = credentialAccounts(store);
    expect((await signInWithPassword(auth, login)).status).toBe(200);

    expect(store.user).toHaveLength(1);
    expect(credentialAccounts(store)).toEqual([first!]);
    expect(reviewAccounts.marked.size).toBe(1);
  });

  test("rehashes the credential when the configured password rotates", async () => {
    const login = reviewLogin("review-rotation");
    const store = makeMemoryAuthStore();
    const reviewAccounts = makeMemoryReviewAccounts();
    const before = makeReviewAuth([login], { store, reviewAccounts });
    expect((await signInWithPassword(before.auth, login)).status).toBe(200);
    const originalHash = credentialAccounts(store)[0]?.password;

    const rotated = { ...login, password: generatedPassword() };
    const after = makeReviewAuth([rotated], { store, reviewAccounts });

    expect((await signInWithPassword(after.auth, login)).status).toBe(401);
    expect((await signInWithPassword(after.auth, rotated)).status).toBe(200);
    expect(store.user).toHaveLength(1);
    const [current, ...others] = credentialAccounts(store);
    expect(others).toHaveLength(0);
    expect(current?.password).toBeString();
    expect(current?.password).not.toBe(originalHash);
  });

  test("keeps the rotated password while a deployment with the old one still runs", async () => {
    const login = reviewLogin("review-rollout");
    const rotated = { ...login, password: generatedPassword() };
    const store = makeMemoryAuthStore();
    const reviewAccounts = makeMemoryReviewAccounts();
    const current = makeReviewAuth([rotated], { store, reviewAccounts });
    const previous = makeReviewAuth([login], { store, reviewAccounts });
    expect((await signInWithPassword(current.auth, rotated)).status).toBe(200);
    const rotatedHash = credentialAccounts(store)[0]?.password;

    expect((await signInWithPassword(previous.auth, rotated)).status).toBe(401);

    expect(credentialAccounts(store)[0]?.password).toBe(rotatedHash);
    expect((await signInWithPassword(current.auth, rotated)).status).toBe(200);
  });

  test("never gives a password to a customer login on a review address", async () => {
    const login = reviewLogin("review-customer-login");
    const sentLinks: CapturedMagicLink[] = [];
    const store = makeMemoryAuthStore();
    const customer = makeReviewAuth([], { store, sentLinks });
    await signInForMagicLink(customer.auth, login.email);
    expect((await verifyMagicLink(customer.auth, sentLinks[0]!)).status).toBe(
      302
    );
    store.session.length = 0;
    const { auth } = makeReviewAuth([login], { store });
    emitWorkspaceLog.mockClear();

    const response = await signInWithPassword(auth, login);

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(credentialAccounts(store)).toHaveLength(0);
    expect(store.session).toHaveLength(0);
    expect(JSON.stringify(emitWorkspaceLog.mock.calls)).toContain(
      "account.review-login.customer-login"
    );
  });

  test("converges on the next sign-in after the login insert failed", async () => {
    const login = reviewLogin("review-retry");
    const store = makeMemoryAuthStore();
    const baseDatabase = memoryAdapter(store);
    let failUserInsert = true;
    const database = (options: Parameters<typeof baseDatabase>[0]) => {
      const adapter = baseDatabase(options);
      return {
        ...adapter,
        create: async (input: Parameters<typeof adapter.create>[0]) => {
          if (input.model === "user" && failUserInsert) {
            failUserInsert = false;
            throw new Error("synthetic login insert failure");
          }
          return adapter.create(input);
        },
      };
    };
    const { auth, reviewAccounts } = makeReviewAuth([login], {
      store,
      database,
    });

    expect((await signInWithPassword(auth, login)).status).toBe(500);
    expect(store.user).toHaveLength(0);
    // The marked account without a login is left to the cleanup cron.
    expect(reviewAccounts.marked.size).toBe(1);

    const retried = await signInWithPassword(auth, login);
    expect(retried.status).toBe(200);
    expect(store.user).toHaveLength(1);
    expect(reviewAccounts.marked.has(store.user[0]!.id)).toBe(true);
    expect(credentialAccounts(store)).toHaveLength(1);
  });

  test("BotID-checks a password sign-in before provisioning", async () => {
    // Imported here so the mocked log sink is in place first.
    const { BotDetectedError } = await import(
      "@/shared/backend/bot-protection/bot-protection.service"
    );
    const login = reviewLogin("review-bot");
    const { auth, store } = makeReviewAuth([login], {
      verifyHuman: () =>
        Effect.fail(
          new BotDetectedError({
            message: "Synthetic automated request.",
            reason: "unverified_bot",
          })
        ),
    });

    const response = await signInWithPassword(auth, login);

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("BOT_DETECTED");
    expect(store.user).toHaveLength(0);
  });

  test.each([false, true])(
    "answers a review login's sign-in email request with the password step and sends nothing (codes on: %p)",
    async (signInCodes) => {
      const login = reviewLogin("review-magic-link");
      const sentLinks: CapturedMagicLink[] = [];
      const { auth, store } = makeReviewAuth([login], {
        sentLinks,
        isSignInCodeEnabled: async () => signInCodes,
      });

      const response = await signInForMagicLink(
        auth,
        login.email.toUpperCase(),
        "/en-US/auth/callback"
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: true,
        method: "password",
      });
      expect(sentLinks).toHaveLength(0);
      expect(store.verification).toHaveLength(0);
      expect(store.user).toHaveLength(0);
    }
  );

  test("refuses passkey registration for a review account", async () => {
    const login = reviewLogin("review-passkey");
    const { auth, store } = makeReviewAuth([login]);
    const cookie = cookieJar(
      getSessionCookie(await signInWithPassword(auth, login))!
    );

    const options = await callHandler(
      auth,
      "/passkey/generate-register-options",
      { headers: { cookie, "x-vercel-forwarded-for": uniqueIp() } }
    );

    expect(options.status).toBe(403);
    expect(await errorCode(options)).toBe("PASSKEY_REGISTRATION_UNAVAILABLE");
    expect(store.passkey).toHaveLength(0);
  });
});

const countRows = async (sql: string, values: readonly unknown[]) =>
  (await testDatabase!.pool.query(sql, [...values])).rowCount ?? 0;

describe.skipIf(!testDatabase)(
  "review login password sign-in on the migrated disposable Postgres",
  () => {
    test("provisions a marked account, a verified login, and one credential", async () => {
      const login = reviewLogin("review-postgres");
      const auth = makeTestAuth({ reviewAccountCredentials: [login] });

      const [first, second] = await Promise.all([
        signInWithPassword(auth, login),
        signInWithPassword(auth, login),
      ]);
      expect([first.status, second.status]).toEqual([200, 200]);
      expect((await signInWithPassword(auth, login)).status).toBe(200);

      const userId = (await userIdForEmail(login.email))!;
      const account = await testDatabase!.pool.query<{
        review: boolean;
        dotypos_customer_id: string | null;
      }>(
        `select review, dotypos_customer_id from customer_accounts where id = $1`,
        [userId]
      );
      expect(account.rows).toEqual([
        { review: true, dotypos_customer_id: null },
      ]);
      expect(
        await countRows(
          `select 1 from auth."user" where email = $1 and email_verified`,
          [login.email]
        )
      ).toBe(1);
      expect(
        await countRows(
          `select 1 from auth.account where user_id = $1 and provider_id = 'credential' and account_id = $1`,
          [userId]
        )
      ).toBe(1);
    });

    test("refuses passkey registration for a review account", async () => {
      const login = reviewLogin("review-postgres-passkey");
      const auth = makeTestAuth({ reviewAccountCredentials: [login] });
      const cookie = cookieJar(
        getSessionCookie(await signInWithPassword(auth, login))!
      );

      const options = await callHandler(
        auth,
        "/passkey/generate-register-options",
        { headers: { cookie, "x-vercel-forwarded-for": uniqueIp() } }
      );

      expect(options.status).toBe(403);
      expect(await errorCode(options)).toBe("PASSKEY_REGISTRATION_UNAVAILABLE");
    });

    test("refuses a customer login on a review address", async () => {
      const login = reviewLogin("review-postgres-customer");
      const sentLinks: CapturedMagicLink[] = [];
      const customer = makeTestAuth({ sentLinks });
      await signInForMagicLink(customer, login.email);
      expect((await verifyMagicLink(customer, sentLinks[0]!)).status).toBe(302);
      const auth = makeTestAuth({ reviewAccountCredentials: [login] });

      const response = await signInWithPassword(auth, login);

      expect(response.status).toBe(401);
      const userId = (await userIdForEmail(login.email))!;
      expect(
        await countRows(`select 1 from auth.account where user_id = $1`, [
          userId,
        ])
      ).toBe(0);
      expect(
        await countRows(
          `select 1 from customer_accounts where id = $1 and review`,
          [userId]
        )
      ).toBe(0);
    });
  }
);
