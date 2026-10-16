import { describe, expect, test } from "bun:test";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Effect } from "effect";
import {
  BotDetectedError,
  type VerifyHumanInput,
} from "@/shared/backend/bot-protection/bot-protection.service";
import {
  buildDatabaseAdapter,
  type CapturedMagicLink,
  callHandler,
  cookieJar,
  getSessionCookie,
  makeMemoryTestAuth,
  makeTestAuth,
  type TestAuth,
  type TestAuthOptions,
  testDatabase,
  uniqueEmail,
  uniqueIp,
  userIdForEmail,
  verifyMagicLink,
} from "./auth-handler.test-utils";
import { digestVerificationKey } from "./auth-options";
import { renderMagicLinkEmail } from "./magic-link-email";

/** Every field these tests send, including the ones the guard rejects. */
type AuthRequestBody = {
  readonly email?: string;
  readonly otp?: string;
  readonly type?: string;
  readonly callbackURL?: string;
  readonly metadata?: {
    readonly locale?: string;
    readonly signInCode?: boolean;
  };
  readonly name?: string;
  readonly image?: string;
  readonly locale?: string;
  readonly deletionRequestedAt?: string;
  readonly emailVerified?: boolean;
};

const postJson = (
  auth: TestAuth,
  path: string,
  body: AuthRequestBody,
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

const sendSignInEmail = (
  auth: TestAuth,
  email: string,
  body: AuthRequestBody = {}
) =>
  postJson(auth, "/sign-in/magic-link", {
    email,
    callbackURL: "/en-US/auth/callback",
    ...body,
  });

const signInWithCode = (
  auth: TestAuth,
  email: string,
  otp: string,
  callbackURL = "/en-US/auth/callback"
) => postJson(auth, "/sign-in/email-otp", { email, otp, callbackURL });

const wrongCode = (code: string) => (code === "000000" ? "111111" : "000000");

const errorCode = async (response: Response) =>
  ((await response.json()) as { readonly code?: string }).code;

/** Whether the address's one stored code is this code. */
const isStoredCode = async (email: string, code: string) =>
  (
    await testDatabase!.pool.query<{ value: string }>(
      `select value from auth.verification where identifier = $1`,
      [await digestVerificationKey(`sign-in-otp-${email.toLowerCase()}`)]
    )
  ).rows[0]?.value.startsWith(`${await digestVerificationKey(code)}:`) ?? false;

const sessionCount = async (email: string) =>
  (
    await testDatabase!.pool.query(
      `select s.id from auth.session s join auth."user" u on u.id = s.user_id
       where u.email = $1`,
      [email.toLowerCase()]
    )
  ).rows.length;

type VerificationWrite = "delete" | "updateMany";

/** The test database adapter, failing chosen verification writes on demand. */
const failingVerificationWrites = () => {
  const fail = new Set<VerificationWrite>();
  const database: NonNullable<TestAuthOptions["database"]> = (options) => {
    const adapter = buildDatabaseAdapter()(options);
    const failOn =
      <Data extends { readonly model: string }, Result>(
        write: VerificationWrite,
        run: (data: Data) => Promise<Result>
      ) =>
      (data: Data) =>
        fail.has(write) && data.model === "verification"
          ? Promise.reject(new Error("synthetic verification write failure"))
          : run(data);
    return {
      ...adapter,
      delete: failOn("delete", adapter.delete),
      updateMany: failOn("updateMany", adapter.updateMany),
    };
  };
  return { fail, database };
};

/**
 * The test database adapter, holding the verification write whose value is
 * `pauseValue` until `resume` is called.
 */
const pausedVerificationCreate = () => {
  let signalPaused!: () => void;
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => {
    signalPaused = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const control = {
    pauseValue: undefined as string | undefined,
    paused,
    resume: () => resume(),
    database: ((options) => {
      const adapter = buildDatabaseAdapter()(options);
      return {
        ...adapter,
        create: async (data) => {
          const row = data.data as { readonly value?: unknown };
          if (
            data.model === "verification" &&
            control.pauseValue !== undefined &&
            row.value === control.pauseValue
          ) {
            signalPaused();
            await resumed;
          }
          return adapter.create(data);
        },
      };
    }) satisfies NonNullable<TestAuthOptions["database"]>,
  };
  return control;
};

/**
 * Holds the verification value `pauseValue` after Better Auth consumes it and
 * before it can write the value back, until `resume` is called.
 */
const pausedVerificationConsume = async (auth: TestAuth) => {
  let signalPaused!: () => void;
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => {
    signalPaused = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const control = {
    pauseValue: undefined as string | undefined,
    paused,
    resume: () => resume(),
  };
  const { internalAdapter } = await auth.$context;
  const consume =
    internalAdapter.consumeVerificationValue.bind(internalAdapter);
  internalAdapter.consumeVerificationValue = async (identifier) => {
    const row = await consume(identifier);
    if (control.pauseValue !== undefined && row?.value === control.pauseValue) {
      signalPaused();
      await resumed;
    }
    return row;
  };
  return control;
};

/**
 * Only the newer email's code signs in, and it ends only its own link: the
 * older link still signs in once.
 */
const expectOnlyNewestCodeSignsIn = async (
  auth: TestAuth,
  email: string,
  links: {
    readonly older: CapturedMagicLink;
    readonly newer: CapturedMagicLink;
  }
) => {
  if (links.older.code !== links.newer.code) {
    const stale = await signInWithCode(auth, email, links.older.code!);
    expect(await errorCode(stale)).toBe("INVALID_OTP");
  }
  const fresh = await signInWithCode(auth, email, links.newer.code!);
  expect(fresh.status).toBe(200);
  expect(getSessionCookie(fresh)).toBeDefined();

  const newerLink = await verifyMagicLink(auth, links.newer);
  expect(getSessionCookie(newerLink)).toBeUndefined();
  expect(newerLink.headers.get("location") ?? "").toContain(
    "error=INVALID_TOKEN"
  );

  const olderLink = await verifyMagicLink(auth, links.older);
  expect(getSessionCookie(olderLink)).toBeDefined();
};

const verificationIdentifierCount = async (identifier: string) =>
  (
    await testDatabase!.pool.query(
      `select id from auth.verification where identifier = $1`,
      [await digestVerificationKey(identifier)]
    )
  ).rows.length;

describe("sign-in code gate", () => {
  test("keeps the link-only email with the flag off and says so", async () => {
    const sentLinks: CapturedMagicLink[] = [];
    let botChecks = 0;
    const { auth, store } = makeMemoryTestAuth({
      sentLinks,
      verifyHuman: () =>
        Effect.sync(() => {
          botChecks += 1;
        }),
    });

    const response = await sendSignInEmail(auth, uniqueEmail("code-off"), {
      metadata: { locale: "en-US", signInCode: true },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true, signInCode: false });
    expect(sentLinks).toHaveLength(1);
    expect(sentLinks[0]!.code).toBeUndefined();
    expect(store.verification).toHaveLength(1);
    expect(botChecks).toBe(0);
  });

  test("fails closed to link-only when the flag cannot be read", async () => {
    const sentLinks: CapturedMagicLink[] = [];
    const { auth } = makeMemoryTestAuth({
      sentLinks,
      isSignInCodeEnabled: () => Promise.reject(new Error("unreadable")),
    });

    const response = await sendSignInEmail(auth, uniqueEmail("code-flag-down"));

    expect(await response.json()).toEqual({ status: true, signInCode: false });
    expect(sentLinks[0]!.code).toBeUndefined();
  });

  test("sends a six-digit code with the link and says so when the flag is on", async () => {
    const sentLinks: CapturedMagicLink[] = [];
    const { auth } = makeMemoryTestAuth({
      sentLinks,
      isSignInCodeEnabled: async () => true,
    });

    const response = await sendSignInEmail(auth, uniqueEmail("code-on"), {
      metadata: { locale: "cs-CZ", signInCode: false },
    });

    expect(await response.json()).toEqual({ status: true, signInCode: true });
    expect(sentLinks[0]!.code).toMatch(/^\d{6}$/);
    expect(sentLinks[0]!.url).toContain("/magic-link/verify");
  });

  test("returns 404 for every email-OTP endpoint except code sign-in", async () => {
    const { auth } = makeMemoryTestAuth();
    const email = uniqueEmail("disabled-otp");

    for (const path of [
      "/email-otp/send-verification-otp",
      "/email-otp/check-verification-otp",
      "/email-otp/verify-email",
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
      "/email-otp/reset-password",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
    ]) {
      const response = await postJson(auth, path, {
        email,
        otp: "123456",
        type: "sign-in",
      });
      expect({ path, status: response.status }).toEqual({ path, status: 404 });
    }
  });

  test("rejects code sign-in fields beyond the email, code, and callback URL", async () => {
    const sentLinks: CapturedMagicLink[] = [];
    const { auth, store } = makeMemoryTestAuth({
      sentLinks,
      isSignInCodeEnabled: async () => true,
    });
    const email = uniqueEmail("code-fields");
    await sendSignInEmail(auth, email);
    const code = sentLinks[0]!.code!;

    for (const extra of [
      { name: "Injected" },
      { image: "https://example.invalid/a.png" },
      { locale: "cs-CZ" },
      { deletionRequestedAt: new Date().toISOString() },
      { emailVerified: false },
    ]) {
      const response = await postJson(auth, "/sign-in/email-otp", {
        email,
        otp: code,
        ...extra,
      });
      expect(response.status).toBe(400);
    }
    expect(store.user).toHaveLength(0);

    const accepted = await signInWithCode(auth, email, code);
    expect(accepted.status).toBe(200);
    expect(store.user).toHaveLength(1);
    expect(store.user[0]!.name).toBe("");
  });

  test("BotID-checks code sign-in always and sign-in emails only while codes are on", async () => {
    const checks: VerifyHumanInput[] = [];
    const bot = (input: VerifyHumanInput) =>
      Effect.suspend(() => {
        checks.push(input);
        return Effect.fail(
          new BotDetectedError({ message: "Automated request detected" })
        );
      });
    const sentLinks: CapturedMagicLink[] = [];
    const off = makeMemoryTestAuth({ sentLinks, verifyHuman: bot });
    const on = makeTestAuth({
      database: memoryAdapter(off.store),
      sentLinks,
      verifyHuman: bot,
      isSignInCodeEnabled: async () => true,
    });
    const email = uniqueEmail("code-bot");

    const linkOnly = await sendSignInEmail(off.auth, email);
    expect(linkOnly.status).toBe(200);
    expect(checks).toHaveLength(0);

    const blockedSend = await sendSignInEmail(on, email);
    expect(blockedSend.status).toBe(403);
    expect(await errorCode(blockedSend)).toBe("BOT_DETECTED");
    expect(sentLinks).toHaveLength(1);

    const blockedSignIn = await signInWithCode(off.auth, email, "123456");
    expect(blockedSignIn.status).toBe(403);
    expect(await errorCode(blockedSignIn)).toBe("BOT_DETECTED");

    expect(checks).toEqual([
      { verificationFailurePolicy: "allow" },
      { verificationFailurePolicy: "allow" },
    ]);
  });
});

describe.skipIf(!testDatabase)(
  "sign-in codes on the migrated disposable Postgres",
  () => {
    const makeCodeAuth = (sentLinks: CapturedMagicLink[]) =>
      makeTestAuth({ sentLinks, isSignInCodeEnabled: async () => true });

    test("signs in with the code read from the rendered email, as the browser sends it", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeCodeAuth(sentLinks);
      const email = uniqueEmail("code-round-trip");
      // The browser's return-window callback and request shapes.
      const callbackURL = `/cs-CZ/auth/callback?attempt=${crypto.randomUUID()}`;

      const sent = await sendSignInEmail(auth, email, {
        callbackURL,
        metadata: { locale: "cs-CZ" },
      });
      expect(await sent.json()).toEqual({ status: true, signInCode: true });
      const [captured] = sentLinks;
      expect(captured?.metadata).toEqual({ locale: "cs-CZ", signInCode: true });

      const { text } = await Effect.runPromise(
        renderMagicLinkEmail({
          email,
          url: captured!.url,
          code: captured!.code,
          locale: "cs-CZ",
        })
      );
      const [code] = text.match(/^[ \t]*\d{6}[ \t]*$/gm) ?? [];
      const response = await signInWithCode(
        auth,
        email,
        code!.trim(),
        callbackURL
      );

      expect(response.status).toBe(200);
      expect(getSessionCookie(response)).toBeDefined();
      expect(await sessionCount(email)).toBe(1);
      const user = await testDatabase!.pool.query<{ locale: string | null }>(
        `select locale from auth."user" where email = $1`,
        [email.toLowerCase()]
      );
      expect(user.rows).toEqual([{ locale: "cs-CZ" }]);
    });

    test("creates a new account through the code with the callback locale", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeCodeAuth(sentLinks);
      const email = uniqueEmail("code-signup");

      await sendSignInEmail(auth, email, {
        callbackURL: "/cs-CZ/auth/callback",
      });
      const response = await signInWithCode(
        auth,
        email,
        sentLinks[0]!.code!,
        "/cs-CZ/auth/callback"
      );

      expect(response.status).toBe(200);
      expect(getSessionCookie(response)).toBeDefined();
      const user = await testDatabase!.pool.query<{
        locale: string | null;
        email_verified: boolean;
        name: string;
      }>(
        `select locale, email_verified, name from auth."user" where email = $1`,
        [email.toLowerCase()]
      );
      expect(user.rows).toEqual([
        { locale: "cs-CZ", email_verified: true, name: "" },
      ]);
    });

    test("using the code removes the link sent with it", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeCodeAuth(sentLinks);
      const email = uniqueEmail("code-ends-link");

      await sendSignInEmail(auth, email);
      const signedIn = await signInWithCode(auth, email, sentLinks[0]!.code!);
      expect(signedIn.status).toBe(200);

      const link = await verifyMagicLink(auth, sentLinks[0]!);
      expect(getSessionCookie(link)).toBeUndefined();
      expect(link.headers.get("location") ?? "").toContain(
        "error=INVALID_TOKEN"
      );
    });

    test("using the link removes the code sent with it", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeCodeAuth(sentLinks);
      const email = uniqueEmail("link-ends-code");

      await sendSignInEmail(auth, email);
      const link = await verifyMagicLink(auth, sentLinks[0]!);
      expect(getSessionCookie(link)).toBeDefined();

      const code = await signInWithCode(auth, email, sentLinks[0]!.code!);
      expect(code.status).toBe(400);
      expect(await errorCode(code)).toBe("INVALID_OTP");
      expect(await verificationIdentifierCount(`sign-in-otp-${email}`)).toBe(0);
    });

    test("a new email replaces the older code without duplicate rows and keeps older links", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeCodeAuth(sentLinks);
      const email = uniqueEmail("code-resend");

      await sendSignInEmail(auth, email);
      await sendSignInEmail(auth, email);
      const [first, second] = sentLinks;

      expect(await verificationIdentifierCount(`sign-in-otp-${email}`)).toBe(1);
      await expectOnlyNewestCodeSignsIn(auth, email, {
        older: first!,
        newer: second!,
      });
    });

    test("concurrent sign-in emails leave one code that ends only its own link", async () => {
      for (let round = 0; round < 5; round += 1) {
        const sentLinks: CapturedMagicLink[] = [];
        const auth = makeCodeAuth(sentLinks);
        const email = uniqueEmail("code-concurrent-send");

        const sends = await Promise.all([
          sendSignInEmail(auth, email),
          sendSignInEmail(auth, email),
        ]);
        expect(sends.map(({ status }) => status)).toEqual([200, 200]);
        expect(await verificationIdentifierCount(`sign-in-otp-${email}`)).toBe(
          1
        );

        const [first, second] = sentLinks;
        const firstIsNewer = await isStoredCode(email, first!.code!);
        await expectOnlyNewestCodeSignsIn(
          auth,
          email,
          firstIsNewer
            ? { older: second!, newer: first! }
            : { older: first!, newer: second! }
        );
      }
    });

    test("a link and its code used at once sign in exactly once", async () => {
      for (let round = 0; round < 10; round += 1) {
        const sentLinks: CapturedMagicLink[] = [];
        const auth = makeCodeAuth(sentLinks);
        const email = uniqueEmail("code-link-race");

        // An existing account: neither path creates the user.
        await sendSignInEmail(auth, email);
        expect(
          getSessionCookie(await verifyMagicLink(auth, sentLinks[0]!))
        ).toBeDefined();
        await sendSignInEmail(auth, email);
        const link = sentLinks[1]!;

        const [linkResponse, codeResponse] = await Promise.all([
          verifyMagicLink(auth, link),
          signInWithCode(auth, email, link.code!),
        ]);

        const signedIn = [linkResponse, codeResponse].filter((response) =>
          getSessionCookie(response)
        );
        expect(signedIn).toHaveLength(1);
        expect(await sessionCount(email)).toBe(2);
        if (getSessionCookie(linkResponse)) {
          expect(await errorCode(codeResponse)).toBe("INVALID_OTP");
        } else {
          expect(linkResponse.headers.get("location") ?? "").toContain(
            "error=INVALID_TOKEN"
          );
        }
      }
    });

    test("an older code that a wrong guess restores after a newer email cannot sign in", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const restore = pausedVerificationCreate();
      const auth = makeTestAuth({
        sentLinks,
        isSignInCodeEnabled: async () => true,
        database: restore.database,
      });
      const email = uniqueEmail("code-restore-race");

      await sendSignInEmail(auth, email);
      const older = sentLinks[0]!;
      // Better Auth consumes the code on a wrong guess and writes it back
      // with one attempt counted; the write-back waits here.
      restore.pauseValue = `${await digestVerificationKey(older.code!)}:1`;
      const wrongGuess = signInWithCode(auth, email, wrongCode(older.code!));
      await restore.paused;

      try {
        await sendSignInEmail(auth, email);
        const newer = await signInWithCode(auth, email, sentLinks[1]!.code!);
        expect(getSessionCookie(newer)).toBeDefined();
      } finally {
        restore.resume();
      }
      expect(await errorCode(await wrongGuess)).toBe("INVALID_OTP");

      const stale = await signInWithCode(auth, email, older.code!);
      expect(await errorCode(stale)).toBe("INVALID_OTP");
      expect(await sessionCount(email)).toBe(1);

      const olderLink = await verifyMagicLink(auth, older);
      expect(getSessionCookie(olderLink)).toBeDefined();
    });

    test("an older code that a wrong guess writes back after a newer email cannot displace the newer code", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        isSignInCodeEnabled: async () => true,
      });
      const consume = await pausedVerificationConsume(auth);
      const email = uniqueEmail("code-restore-displace");

      await sendSignInEmail(auth, email);
      const older = sentLinks[0]!;
      // The wrong guess consumes the older code and waits before Better Auth
      // writes it back, so the write-back lands after the newer email.
      consume.pauseValue = `${await digestVerificationKey(older.code!)}:0`;
      const wrongGuess = signInWithCode(auth, email, wrongCode(older.code!));
      await consume.paused;

      try {
        await sendSignInEmail(auth, email);
      } finally {
        consume.resume();
      }
      expect(await errorCode(await wrongGuess)).toBe("INVALID_OTP");

      const newer = await signInWithCode(auth, email, sentLinks[1]!.code!);
      expect(newer.status).toBe(200);
      expect(getSessionCookie(newer)).toBeDefined();

      const stale = await signInWithCode(auth, email, older.code!);
      expect(await errorCode(stale)).toBe("INVALID_OTP");
      expect(await sessionCount(email)).toBe(1);
    });

    test("clock skew wider than the gap between two emails can displace the newer code, but fails safe until a new email", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        isSignInCodeEnabled: async () => true,
      });
      const consume = await pausedVerificationConsume(auth);
      const email = uniqueEmail("code-restore-skew");

      await sendSignInEmail(auth, email);
      const older = sentLinks[0]!;
      consume.pauseValue = `${await digestVerificationKey(older.code!)}:0`;
      const wrongGuess = signInWithCode(auth, email, wrongCode(older.code!));
      await consume.paused;

      try {
        await sendSignInEmail(auth, email);
        // The instance that issued the newer code runs a minute behind the
        // one that issued the older code, so the older code's write-back is
        // dated after it.
        await testDatabase!.pool.query(
          `update auth.verification
           set created_at = created_at - interval '60 seconds'
           where identifier = $1`,
          [await digestVerificationKey(`sign-in-otp-${email.toLowerCase()}`)]
        );
      } finally {
        consume.resume();
      }
      expect(await errorCode(await wrongGuess)).toBe("INVALID_OTP");

      const newer = await signInWithCode(auth, email, sentLinks[1]!.code!);
      expect(await errorCode(newer)).toBe("INVALID_OTP");
      const stale = await signInWithCode(auth, email, older.code!);
      expect(await errorCode(stale)).toBe("INVALID_OTP");
      expect(await sessionCount(email)).toBe(0);

      await sendSignInEmail(auth, email);
      const fresh = await signInWithCode(auth, email, sentLinks[2]!.code!);
      expect(fresh.status).toBe(200);
      expect(getSessionCookie(fresh)).toBeDefined();
      expect(await sessionCount(email)).toBe(1);
    });

    test("a code sign-in that cannot take its claim creates no session", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const failing = failingVerificationWrites();
      const auth = makeTestAuth({
        sentLinks,
        isSignInCodeEnabled: async () => true,
        database: failing.database,
      });
      const email = uniqueEmail("code-claim-failure");

      await sendSignInEmail(auth, email);
      failing.fail.add("updateMany");
      const code = await signInWithCode(auth, email, sentLinks[0]!.code!);
      failing.fail.clear();

      expect(code.status).toBe(500);
      expect(getSessionCookie(code)).toBeUndefined();
      expect(await sessionCount(email)).toBe(0);
    });

    test("a link whose code signed in fails when it cannot be revoked", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const failing = failingVerificationWrites();
      const auth = makeTestAuth({
        sentLinks,
        isSignInCodeEnabled: async () => true,
        database: failing.database,
      });
      const email = uniqueEmail("link-revoke-failure");

      await sendSignInEmail(auth, email);
      const code = await signInWithCode(auth, email, sentLinks[0]!.code!);
      expect(getSessionCookie(code)).toBeDefined();

      failing.fail.add("delete");
      const link = await verifyMagicLink(auth, sentLinks[0]!);
      failing.fail.clear();

      expect(link.status).toBe(500);
      expect(getSessionCookie(link)).toBeUndefined();
      expect(await sessionCount(email)).toBe(1);
    });

    test("rate limits code sign-ins per IP through the shared database", async () => {
      const authA = makeCodeAuth([]);
      const authB = makeCodeAuth([]);
      const ip = uniqueIp();
      const attempt = (auth: TestAuth) =>
        postJson(
          auth,
          "/sign-in/email-otp",
          { email: uniqueEmail("code-rate"), otp: "000000" },
          { "x-vercel-forwarded-for": ip }
        );

      for (let index = 0; index < 10; index += 1) {
        const response = await attempt(index % 2 === 0 ? authA : authB);
        expect(response.status).toBe(400);
      }

      const blocked = await attempt(authB);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("x-retry-after")).toBeTruthy();
      const rateRows = await testDatabase!.pool.query(
        `select key from auth.rate_limit where key = $1`,
        [`${ip}|/sign-in/email-otp`]
      );
      expect(rateRows.rows).toHaveLength(1);

      const otherIp = await postJson(authA, "/sign-in/email-otp", {
        email: uniqueEmail("code-rate"),
        otp: "000000",
      });
      expect(otherIp.status).toBe(400);
    });

    test("burns the code after five wrong attempts", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeCodeAuth(sentLinks);
      const email = uniqueEmail("code-attempts");

      await sendSignInEmail(auth, email);
      const code = sentLinks[0]!.code!;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const wrong = await signInWithCode(auth, email, wrongCode(code));
        expect(await errorCode(wrong)).toBe("INVALID_OTP");
      }
      const exhausted = await signInWithCode(auth, email, code);
      expect(exhausted.status).toBe(403);
      expect(await errorCode(exhausted)).toBe("TOO_MANY_ATTEMPTS");

      const burned = await signInWithCode(auth, email, code);
      expect(await errorCode(burned)).toBe("INVALID_OTP");
      expect(await userIdForEmail(email.toLowerCase())).toBeUndefined();
    });

    test("caps sign-in emails per address per rolling hour while codes are on", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeCodeAuth(sentLinks);
      const email = uniqueEmail("code-cap");

      for (let send = 0; send < 5; send += 1) {
        const accepted = await sendSignInEmail(auth, email);
        expect(accepted.status).toBe(200);
      }
      const capped = await sendSignInEmail(auth, email.toUpperCase());
      expect(capped.status).toBe(429);
      expect(await errorCode(capped)).toBe("SIGN_IN_EMAIL_LIMIT_REACHED");
      expect(sentLinks).toHaveLength(5);

      // Rejected sends don't extend the window; aged-out sends free it.
      await testDatabase!.pool.query(
        `update auth.verification set expires_at = now() - interval '1 second'
         where identifier = $1`,
        [`sign-in-email-${await digestVerificationKey(email.toLowerCase())}`]
      );
      expect((await sendSignInEmail(auth, email)).status).toBe(200);

      const linkOnly = makeTestAuth({ sentLinks });
      for (let send = 0; send < 6; send += 1) {
        expect((await sendSignInEmail(linkOnly, email)).status).toBe(200);
      }
    });

    test("a code sign-in satisfies the fresh session that deletion requires", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      let deletions = 0;
      const auth = makeTestAuth({
        sentLinks,
        isSignInCodeEnabled: async () => true,
        beforeDeleteUser: () =>
          Effect.sync(() => {
            deletions += 1;
          }),
      });
      const email = uniqueEmail("code-reauth");

      await sendSignInEmail(auth, email);
      const first = await signInWithCode(auth, email, sentLinks[0]!.code!);
      const staleCookie = cookieJar(getSessionCookie(first)!);
      const userId = (await userIdForEmail(email.toLowerCase()))!;
      await testDatabase!.pool.query(
        `update auth.session set created_at = now() - interval '20 minutes' where user_id = $1`,
        [userId]
      );

      const stale = await postJson(
        auth,
        "/delete-user",
        {},
        { cookie: staleCookie }
      );
      expect(stale.status).toBe(400);

      await sendSignInEmail(auth, email);
      const reauthenticated = await signInWithCode(
        auth,
        email,
        sentLinks[1]!.code!
      );
      const freshCookie = cookieJar(getSessionCookie(reauthenticated)!);
      const deleted = await postJson(
        auth,
        "/delete-user",
        {},
        { cookie: freshCookie }
      );

      expect(deleted.status).toBe(200);
      expect(deletions).toBe(1);
      expect(await userIdForEmail(email.toLowerCase())).toBeUndefined();
    });
  }
);
