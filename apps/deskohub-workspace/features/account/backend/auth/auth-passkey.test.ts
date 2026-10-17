import { describe, expect, test } from "bun:test";
import {
  type CapturedMagicLink,
  callHandler,
  cookieJar,
  getSessionCookie,
  HOST,
  makeTestAuth,
  signInForMagicLink,
  type TestAuth,
  testDatabase,
  uniqueEmail,
  uniqueIp,
  userIdForEmail,
  verifyMagicLink,
} from "./auth-handler.test-utils";
import {
  anonymousAaguid,
  googlePasswordManagerAaguid,
  makeSoftwarePasskey,
  type SoftwarePasskey,
} from "./passkey-authenticator.test-utils";

const ORIGIN = `https://${HOST}`;

const newPasskey = (aaguid?: string) =>
  makeSoftwarePasskey({ rpID: HOST, origin: ORIGIN, aaguid });

/** The `name=value` pairs a response sets, for the next request's cookie. */
const setCookies = (response: Response) =>
  response.headers.getSetCookie().map(cookieJar);

const cookieHeader = (...cookies: readonly (string | undefined)[]) =>
  cookies.filter(Boolean).join("; ");

const signInByEmail = async (auth: TestAuth, label: string) => {
  const sentLinks: CapturedMagicLink[] = [];
  const email = uniqueEmail(label);
  const captureAuth = makeTestAuth({ sentLinks });
  await signInForMagicLink(captureAuth, email);
  const verified = await verifyMagicLink(auth, sentLinks[0]!);
  return {
    email,
    userId: (await userIdForEmail(email))!,
    cookie: cookieJar(getSessionCookie(verified)!),
  };
};

const ageSessions = (userId: string, minutes: number) =>
  testDatabase!.pool.query(
    `update auth.session set created_at = now() - make_interval(mins => $2) where user_id = $1`,
    [userId, minutes]
  );

const passkeysOf = async (userId: string) =>
  (
    await testDatabase!.pool.query<{ name: string | null; aaguid: string }>(
      `select name, aaguid from auth.passkey where user_id = $1`,
      [userId]
    )
  ).rows;

const sessionCountOf = async (userId: string) =>
  (
    await testDatabase!.pool.query(
      `select id from auth.session where user_id = $1`,
      [userId]
    )
  ).rowCount;

const requestRegistrationOptions = (auth: TestAuth, cookie: string) =>
  callHandler(auth, "/passkey/generate-register-options", {
    headers: { cookie, "x-vercel-forwarded-for": uniqueIp() },
  });

const registerPasskey = async (
  auth: TestAuth,
  cookie: string,
  authenticator: SoftwarePasskey,
  body: { readonly name?: string } = {}
) => {
  const options = await requestRegistrationOptions(auth, cookie);
  expect(options.status).toBe(200);
  return callHandler(auth, "/passkey/verify-registration", {
    method: "POST",
    headers: {
      cookie: cookieHeader(cookie, ...setCookies(options)),
      "content-type": "application/json",
      "x-vercel-forwarded-for": uniqueIp(),
    },
    body: JSON.stringify({
      ...body,
      response: authenticator.register(await options.json()),
    }),
  });
};

const requestAuthenticationOptions = (auth: TestAuth, cookie?: string) =>
  callHandler(auth, "/passkey/generate-authenticate-options", {
    headers: {
      cookie: cookieHeader(cookie),
      "x-vercel-forwarded-for": uniqueIp(),
    },
  });

const assertPasskey = async (
  auth: TestAuth,
  authenticator: SoftwarePasskey,
  {
    cookie,
    userVerified,
  }: { readonly cookie?: string; readonly userVerified?: boolean } = {}
) => {
  const options = await requestAuthenticationOptions(auth, cookie);
  expect(options.status).toBe(200);
  return callHandler(auth, "/passkey/verify-authentication", {
    method: "POST",
    headers: {
      cookie: cookieHeader(cookie, ...setCookies(options)),
      "content-type": "application/json",
      "x-vercel-forwarded-for": uniqueIp(),
    },
    body: JSON.stringify({
      response: authenticator.authenticate(await options.json(), {
        userVerified,
      }),
    }),
  });
};

const sessionUserId = async (auth: TestAuth, cookie: string) => {
  const response = await callHandler(auth, "/get-session", {
    headers: { cookie },
  });
  const body = (await response.json()) as { user?: { id: string } } | null;
  return body?.user?.id;
};

const errorCode = async (response: Response) =>
  ((await response.json()) as { code?: string }).code;

describe.skipIf(!testDatabase)(
  "Better Auth passkeys on the migrated disposable Postgres",
  () => {
    test("names a passkey after its provider unless the customer named it", async () => {
      const auth = makeTestAuth();
      const customer = await signInByEmail(auth, "passkey-name");

      const named = await registerPasskey(
        auth,
        customer.cookie,
        newPasskey(googlePasswordManagerAaguid)
      );
      expect(named.status).toBe(200);
      const custom = await registerPasskey(
        auth,
        customer.cookie,
        newPasskey(googlePasswordManagerAaguid),
        { name: "Work laptop" }
      );
      expect(custom.status).toBe(200);
      const anonymous = await registerPasskey(
        auth,
        customer.cookie,
        newPasskey(anonymousAaguid)
      );
      expect(anonymous.status).toBe(200);

      expect(
        (await passkeysOf(customer.userId)).map(({ name }) => name).sort()
      ).toEqual(["Google Password Manager", "Work laptop", null].sort());
    });

    test("refuses new passkeys while login_passkeys is off or unreadable", async () => {
      let flag: () => Promise<boolean> = async () => false;
      const auth = makeTestAuth({ arePasskeysEnabled: () => flag() });
      const customer = await signInByEmail(auth, "passkey-flag");

      const refused = await requestRegistrationOptions(auth, customer.cookie);
      expect(refused.status).toBe(403);
      expect(await errorCode(refused)).toBe("PASSKEY_REGISTRATION_UNAVAILABLE");

      flag = () => Promise.reject(new Error("unreadable"));
      const unreadable = await requestRegistrationOptions(
        auth,
        customer.cookie
      );
      expect(unreadable.status).toBe(403);

      // Options issued while the flag was on can't be completed after it
      // turns off.
      flag = async () => true;
      const options = await requestRegistrationOptions(auth, customer.cookie);
      expect(options.status).toBe(200);
      flag = async () => false;
      const verify = await callHandler(auth, "/passkey/verify-registration", {
        method: "POST",
        headers: {
          cookie: cookieHeader(customer.cookie, ...setCookies(options)),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          response: newPasskey().register(await options.json()),
        }),
      });
      expect(verify.status).toBe(403);
      expect(await errorCode(verify)).toBe("PASSKEY_REGISTRATION_UNAVAILABLE");
      expect(await passkeysOf(customer.userId)).toHaveLength(0);
    });

    test("keeps passkey sign-in open while login_passkeys is off", async () => {
      let passkeysEnabled = true;
      const auth = makeTestAuth({
        arePasskeysEnabled: async () => passkeysEnabled,
      });
      const customer = await signInByEmail(auth, "passkey-sign-in");
      const authenticator = newPasskey();
      expect(
        (await registerPasskey(auth, customer.cookie, authenticator)).status
      ).toBe(200);

      passkeysEnabled = false;
      const signedIn = await assertPasskey(auth, authenticator);

      expect(signedIn.status).toBe(200);
      const cookie = cookieJar(getSessionCookie(signedIn)!);
      expect(await sessionUserId(auth, cookie)).toBe(customer.userId);
    });

    test("asks for user verification and the account's own passkeys only on reauthentication", async () => {
      const auth = makeTestAuth();
      const customer = await signInByEmail(auth, "passkey-options");
      const authenticator = newPasskey();
      await registerPasskey(auth, customer.cookie, authenticator);

      const signIn = await requestAuthenticationOptions(auth);
      expect(await signIn.json()).toMatchObject({
        userVerification: "preferred",
      });

      const reauthentication = await requestAuthenticationOptions(
        auth,
        customer.cookie
      );
      // The rewritten options keep the challenge cookie the ceremony needs.
      expect(
        setCookies(reauthentication).some((cookie) =>
          cookie.includes("better-auth-passkey=")
        )
      ).toBe(true);
      const options = (await reauthentication.json()) as {
        readonly userVerification: string;
        readonly allowCredentials: readonly { readonly id: string }[];
      };
      expect(options.userVerification).toBe("required");
      expect(options.allowCredentials.map(({ id }) => id)).toEqual([
        authenticator.id,
      ]);
    });

    test("refreshes a stale session with the same account's passkey, then adds a passkey", async () => {
      const auth = makeTestAuth();
      const customer = await signInByEmail(auth, "passkey-stale");
      const authenticator = newPasskey();
      await registerPasskey(auth, customer.cookie, authenticator);
      await ageSessions(customer.userId, 11);

      const stale = await requestRegistrationOptions(auth, customer.cookie);
      expect(stale.status).toBe(403);
      expect(await errorCode(stale)).toBe("SESSION_NOT_FRESH");

      const reauthenticated = await assertPasskey(auth, authenticator, {
        cookie: customer.cookie,
      });
      expect(reauthenticated.status).toBe(200);
      const freshCookie = cookieJar(getSessionCookie(reauthenticated)!);
      expect(await sessionUserId(auth, freshCookie)).toBe(customer.userId);

      expect(
        (await registerPasskey(auth, freshCookie, newPasskey())).status
      ).toBe(200);
      expect(await passkeysOf(customer.userId)).toHaveLength(2);
    });

    test("rejects another account's passkey without replacing the session", async () => {
      const auth = makeTestAuth();
      const customer = await signInByEmail(auth, "passkey-owner");
      const other = await signInByEmail(auth, "passkey-other");
      const otherPasskey = newPasskey();
      await registerPasskey(auth, other.cookie, otherPasskey);
      const otherSessions = await sessionCountOf(other.userId);

      const rejected = await assertPasskey(auth, otherPasskey, {
        cookie: customer.cookie,
      });

      expect(rejected.status).toBe(403);
      expect(await errorCode(rejected)).toBe("PASSKEY_ACCOUNT_MISMATCH");
      expect(getSessionCookie(rejected)).toBeUndefined();
      expect(await sessionCountOf(other.userId)).toBe(otherSessions);
      expect(await sessionUserId(auth, customer.cookie)).toBe(customer.userId);
    });

    test("rejects a reauthentication without user verification", async () => {
      const auth = makeTestAuth();
      const customer = await signInByEmail(auth, "passkey-uv");
      const authenticator = newPasskey();
      await registerPasskey(auth, customer.cookie, authenticator);
      const sessions = await sessionCountOf(customer.userId);

      const rejected = await assertPasskey(auth, authenticator, {
        cookie: customer.cookie,
        userVerified: false,
      });

      expect(rejected.status).toBe(403);
      expect(await errorCode(rejected)).toBe(
        "PASSKEY_USER_VERIFICATION_REQUIRED"
      );
      expect(getSessionCookie(rejected)).toBeUndefined();
      expect(await sessionCountOf(customer.userId)).toBe(sessions);
    });

    test("signs in without a session from a passkey that skipped user verification", async () => {
      const auth = makeTestAuth();
      const customer = await signInByEmail(auth, "passkey-anonymous");
      const authenticator = newPasskey();
      await registerPasskey(auth, customer.cookie, authenticator);

      const signedIn = await assertPasskey(auth, authenticator, {
        userVerified: false,
      });

      expect(signedIn.status).toBe(200);
      expect(
        await sessionUserId(auth, cookieJar(getSessionCookie(signedIn)!))
      ).toBe(customer.userId);
    });

    test("confirms a stale account deletion with a passkey and removes every passkey", async () => {
      const auth = makeTestAuth();
      const customer = await signInByEmail(auth, "passkey-delete");
      const authenticator = newPasskey();
      await registerPasskey(auth, customer.cookie, authenticator);
      await registerPasskey(auth, customer.cookie, newPasskey());
      await ageSessions(customer.userId, 11);

      const deleteUser = (cookie: string) =>
        callHandler(auth, "/delete-user", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: "{}",
        });
      const stale = await deleteUser(customer.cookie);
      expect(stale.status).toBe(400);
      expect(await errorCode(stale)).toBe("SESSION_EXPIRED");

      const reauthenticated = await assertPasskey(auth, authenticator, {
        cookie: customer.cookie,
      });
      expect(reauthenticated.status).toBe(200);
      const deleted = await deleteUser(
        cookieJar(getSessionCookie(reauthenticated)!)
      );

      expect(deleted.status).toBe(200);
      expect(await userIdForEmail(customer.email)).toBeUndefined();
      expect(await passkeysOf(customer.userId)).toHaveLength(0);
    });

    test("limits passkey sign-in attempts per client IP", async () => {
      const auth = makeTestAuth();
      const ip = uniqueIp();
      const attempt = () =>
        callHandler(auth, "/passkey/verify-authentication", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-vercel-forwarded-for": ip,
          },
          body: JSON.stringify({ response: {} }),
        });

      for (let request = 0; request < 10; request += 1) {
        expect((await attempt()).status).not.toBe(429);
      }
      expect((await attempt()).status).toBe(429);
    });
  }
);
