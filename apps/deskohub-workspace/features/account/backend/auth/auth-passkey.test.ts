import { describe, expect, test } from "bun:test";
import {
  type CapturedMagicLink,
  callHandler,
  callNativeHandler,
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
import { resolvePasskeyRelyingParty } from "./auth-hosts";
import { androidApkKeyHashOrigin, nativeApp } from "./native-app";
import {
  anonymousAaguid,
  googlePasswordManagerAaguid,
  makeSoftwarePasskey,
  type SoftwarePasskey,
} from "./passkey-authenticator.test-utils";

const ORIGIN = `https://${HOST}`;

/** Sends one auth request as a browser (the default) or as the native app. */
type AuthClient = (
  auth: TestAuth,
  path: string,
  init?: RequestInit
) => Promise<Response>;

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

const requestRegistrationOptions = (
  auth: TestAuth,
  cookie: string,
  client: AuthClient = callHandler
) =>
  client(auth, "/passkey/generate-register-options", {
    headers: { cookie, "x-vercel-forwarded-for": uniqueIp() },
  });

const registerPasskey = async (
  auth: TestAuth,
  cookie: string,
  authenticator: SoftwarePasskey,
  {
    name,
    client = callHandler,
  }: { readonly name?: string; readonly client?: AuthClient } = {}
) => {
  const options = await requestRegistrationOptions(auth, cookie, client);
  expect(options.status).toBe(200);
  return client(auth, "/passkey/verify-registration", {
    method: "POST",
    headers: {
      cookie: cookieHeader(cookie, ...setCookies(options)),
      "content-type": "application/json",
      "x-vercel-forwarded-for": uniqueIp(),
    },
    body: JSON.stringify({
      // `JSON.stringify` leaves an unnamed passkey's `name` out.
      name,
      response: authenticator.register(await options.json()),
    }),
  });
};

const requestAuthenticationOptions = (
  auth: TestAuth,
  cookie?: string,
  client: AuthClient = callHandler
) =>
  client(auth, "/passkey/generate-authenticate-options", {
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
    origin,
    client = callHandler,
  }: {
    readonly cookie?: string;
    readonly userVerified?: boolean;
    readonly origin?: string;
    readonly client?: AuthClient;
  } = {}
) => {
  const options = await requestAuthenticationOptions(auth, cookie, client);
  expect(options.status).toBe(200);
  return client(auth, "/passkey/verify-authentication", {
    method: "POST",
    headers: {
      cookie: cookieHeader(cookie, ...setCookies(options)),
      "content-type": "application/json",
      "x-vercel-forwarded-for": uniqueIp(),
    },
    body: JSON.stringify({
      response: authenticator.authenticate(await options.json(), {
        userVerified,
        origin,
      }),
    }),
  });
};

const sessionUserId = async (
  auth: TestAuth,
  cookie: string,
  client: AuthClient = callHandler
) => {
  const response = await client(auth, "/get-session", {
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

describe.skipIf(!testDatabase)(
  "native app passkeys on the production relying party",
  () => {
    // The production relying party built from fixed values, with the test
    // host as the customer-facing host so requests reach the instance.
    const productionRelyingParty = (() => {
      const result = resolvePasskeyRelyingParty({
        vercelEnv: "production",
        customerFacingHost: HOST,
        projectProductionUrl: undefined,
        deploymentUrl: undefined,
        branchUrl: undefined,
      });
      if (result.kind === "invalid") throw new Error(result.message);
      return result.relyingParty;
    })();
    const releaseAppOrigin = androidApkKeyHashOrigin(
      nativeApp.androidReleaseCertificate
    );
    const otherKeyOrigin = androidApkKeyHashOrigin(
      Array.from({ length: 32 }, () => "5A").join(":")
    );
    const makeProductionAuth = () =>
      makeTestAuth({ passkeyRelyingParty: productionRelyingParty });
    const appPasskey = (origin = releaseAppOrigin) =>
      makeSoftwarePasskey({ rpID: HOST, origin });
    const app = { client: callNativeHandler } as const;

    test("registers and signs in with a passkey from the release-signed app", async () => {
      const auth = makeProductionAuth();
      const customer = await signInByEmail(auth, "native-passkey");
      const authenticator = appPasskey();

      expect(
        (await registerPasskey(auth, customer.cookie, authenticator, app))
          .status
      ).toBe(200);
      const signedIn = await assertPasskey(auth, authenticator, app);

      expect(signedIn.status).toBe(200);
      expect(
        await sessionUserId(
          auth,
          cookieJar(getSessionCookie(signedIn)!),
          callNativeHandler
        )
      ).toBe(customer.userId);
    });

    test("refuses passkey ceremonies from an app signed with another key", async () => {
      const auth = makeProductionAuth();
      const customer = await signInByEmail(auth, "native-passkey-other-key");

      const registration = await registerPasskey(
        auth,
        customer.cookie,
        appPasskey(otherKeyOrigin),
        app
      );
      expect(registration.status).toBe(500);
      expect(await passkeysOf(customer.userId)).toEqual([]);

      const sitePasskey = newPasskey();
      await registerPasskey(auth, customer.cookie, sitePasskey);
      const assertion = await assertPasskey(auth, sitePasskey, {
        ...app,
        origin: otherKeyOrigin,
      });
      expect(assertion.status).toBe(400);
      expect(getSessionCookie(assertion)).toBeUndefined();
    });

    test("keeps browser passkeys working beside the app", async () => {
      const auth = makeProductionAuth();
      const customer = await signInByEmail(auth, "native-passkey-browser");
      const authenticator = newPasskey();

      expect(
        (await registerPasskey(auth, customer.cookie, authenticator)).status
      ).toBe(200);
      const signedIn = await assertPasskey(auth, authenticator);

      expect(signedIn.status).toBe(200);
      expect(
        await sessionUserId(auth, cookieJar(getSessionCookie(signedIn)!))
      ).toBe(customer.userId);
    });

    test("signs the app in with a passkey the site created", async () => {
      const auth = makeProductionAuth();
      const customer = await signInByEmail(auth, "native-passkey-shared");
      const authenticator = newPasskey();
      await registerPasskey(auth, customer.cookie, authenticator);

      const signedIn = await assertPasskey(auth, authenticator, {
        ...app,
        origin: releaseAppOrigin,
      });

      expect(signedIn.status).toBe(200);
      expect(
        await sessionUserId(
          auth,
          cookieJar(getSessionCookie(signedIn)!),
          callNativeHandler
        )
      ).toBe(customer.userId);
    });

    test("refuses native requests without a trusted app scheme", async () => {
      const auth = makeProductionAuth();
      const customer = await signInByEmail(auth, "native-passkey-scheme");

      for (const expoOrigin of [null, "evil://"]) {
        const registration = await registerPasskey(
          auth,
          customer.cookie,
          appPasskey(),
          {
            client: (requestAuth, path, init) =>
              callNativeHandler(requestAuth, path, init, expoOrigin),
          }
        );
        expect(registration.status).toBe(403);
      }
      expect(await passkeysOf(customer.userId)).toEqual([]);
    });
  }
);
