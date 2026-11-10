import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { customerSignInLocaleHeader } from "@deskohub/workspace-customer-api/customer-locale";
import { Effect } from "effect";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  type CapturedMagicLink,
  callHandler,
  callNativeHandler,
  cookieJar,
  getSessionCookie,
  HOST,
  makeMemoryTestAuth,
  makeTestAuth,
  signInForMagicLink,
  type TestAuth,
  testDatabase,
  uniqueEmail,
  uniqueIp,
  userIdForEmail,
  verifyMagicLink,
  workspaceLogs,
} from "./auth-handler.test-utils";

/**
 * Native app sign-in. A sign-in email the `/app/` page sends carries the
 * app's App Link, which the app verifies itself. The PKCE-bound handoff moves
 * a browser sign-in into the app: the `/app/` page mints a code for the app's
 * challenge, and the app redeems it with its verifier for a session of its
 * own.
 */

const appReturnURI = "deskohub://auth/callback";
const appLinkReturnURI = `https://${HOST}/app/auth/callback`;

/** RFC 7636 Appendix B: a verifier and its S256 challenge. */
const rfcVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const rfcChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const makePkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
};

afterEach(() => setSystemTime());

const signIn = async (auth: TestAuth) => {
  const sentLinks: CapturedMagicLink[] = [];
  const sender = makeTestAuth({ sentLinks });
  const email = uniqueEmail("native-handoff");
  expect((await signInForMagicLink(sender, email, "/app/account")).status).toBe(
    200
  );
  const verified = await verifyMagicLink(auth, sentLinks[0]!);
  return { email, cookie: cookieJar(getSessionCookie(verified)!) };
};

type MintBody = {
  readonly code_challenge?: string;
  readonly code_challenge_method?: string;
  readonly state?: string;
  readonly return_uri?: string;
};

const mint = (
  auth: TestAuth,
  body: MintBody,
  cookie?: string,
  ip: string = uniqueIp()
) => {
  const headers = new Headers({
    "content-type": "application/json",
    "x-vercel-forwarded-for": ip,
  });
  if (cookie) headers.set("cookie", cookie);
  return callHandler(auth, "/native-handoff/mint", {
    method: "POST",
    headers: Object.fromEntries(headers),
    body: JSON.stringify(body),
  });
};

const exchange = (
  auth: TestAuth,
  body: {
    readonly code: string;
    readonly code_verifier: string;
    readonly return_uri: string;
  },
  ip: string = uniqueIp()
) =>
  callNativeHandler(auth, "/native-handoff/exchange", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });

const mintedCode = async (response: Response) => {
  expect(response.status).toBe(200);
  const { url } = (await response.json()) as { url: string };
  return new URL(url);
};

const errorCode = async (response: Response) =>
  ((await response.json()) as { code?: string }).code;

const sessionEmail = async (auth: TestAuth, response: Response) => {
  const setCookie = getSessionCookie(response);
  expect(setCookie).toBeDefined();
  const session = await callNativeHandler(auth, "/get-session", {
    headers: { cookie: cookieJar(setCookie!) },
  });
  return ((await session.json()) as { user?: { email: string } } | null)?.user
    ?.email;
};

describe("magic-link App Link", () => {
  const sendFor = async (
    body: Record<string, string>,
    sentLinks: CapturedMagicLink[] = []
  ) => {
    const { auth } = makeMemoryTestAuth({ sentLinks });
    const response = await callHandler(auth, "/sign-in/magic-link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vercel-forwarded-for": uniqueIp(),
      },
      body: JSON.stringify({ email: uniqueEmail("app-link"), ...body }),
    });
    expect(response.status).toBe(200);
    return { auth, link: sentLinks[0]! };
  };

  test("emails the App Link with only the token for the app callback", async () => {
    const { link } = await sendFor({ callbackURL: "/app/auth/callback" });

    expect(link.url).toBe(
      `https://${HOST}/app/auth/callback?token=${encodeURIComponent(link.token)}`
    );
  });

  test("emails the verification link for every other callback", async () => {
    for (const body of [
      { callbackURL: "/cs-CZ/auth/callback" },
      { callbackURL: "/app/account" },
      { callbackURL: "/app/auth/callback?next=1" },
      { callbackURL: "/app/auth/callback/" },
      { callbackURL: "deskohub://auth/callback" },
      {
        callbackURL: "/app/auth/callback",
        errorCallbackURL: "/app/sign-in",
      },
      {
        callbackURL: "/app/auth/callback",
        newUserCallbackURL: "/app/welcome",
      },
      {},
    ]) {
      const { link } = await sendFor(body);
      const url = new URL(link.url);
      expect(`${url.origin}${url.pathname}`).toBe(
        `https://${HOST}/api/auth/magic-link/verify`
      );
      expect(url.searchParams.get("callbackURL")).toBe(body.callbackURL ?? "/");
    }
  });

  test("lets the app verify its App Link token for JSON and the session cookie", async () => {
    const { auth, link } = await sendFor({ callbackURL: "/app/auth/callback" });
    const token = new URL(link.url).searchParams.get("token")!;

    const verified = await callNativeHandler(
      auth,
      `/magic-link/verify?token=${encodeURIComponent(token)}`
    );
    expect(verified.status).toBe(200);
    expect(verified.headers.get("content-type")).toContain("application/json");
    expect(await sessionEmail(auth, verified)).toBeDefined();

    const replayed = await callNativeHandler(
      auth,
      `/magic-link/verify?token=${encodeURIComponent(token)}`
    );
    expect(replayed.status).toBe(400);
    expect(replayed.headers.get("location")).toBeNull();
    expect(replayed.headers.get("cache-control")).toBe("no-store");
    expect(await errorCode(replayed)).toBe("INVALID_TOKEN");
  });

  test("answers an expired App Link token with JSON", async () => {
    const { auth, link } = await sendFor({ callbackURL: "/app/auth/callback" });
    const token = new URL(link.url).searchParams.get("token")!;
    setSystemTime(new Date(Date.now() + 10 * 60 * 1000 + 1000));

    const expired = await callNativeHandler(
      auth,
      `/magic-link/verify?token=${encodeURIComponent(token)}`
    );
    expect(expired.status).toBe(400);
    expect(expired.headers.get("location")).toBeNull();
    expect(await errorCode(expired)).toBe("INVALID_TOKEN");
    expect(getSessionCookie(expired)).toBeUndefined();
  });

  describe("with a session already in the app", () => {
    const appSignIns = ({ signInCodes = false } = {}) => {
      const sentLinks: CapturedMagicLink[] = [];
      const { auth } = makeMemoryTestAuth({
        sentLinks,
        signInCodeFlag: Effect.succeed(signInCodes),
      });
      const sendLink = async (email: string) => {
        const sent = await callHandler(auth, "/sign-in/magic-link", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-vercel-forwarded-for": uniqueIp(),
          },
          body: JSON.stringify({ email, callbackURL: "/app/auth/callback" }),
        });
        expect(sent.status).toBe(200);
        return new URL(sentLinks.at(-1)!.url).searchParams.get("token")!;
      };
      const verify = (token: string, cookie?: string) =>
        callNativeHandler(
          auth,
          `/magic-link/verify?token=${encodeURIComponent(token)}`,
          cookie ? { headers: { cookie } } : {}
        );
      const signedIn = async (email: string) => {
        const verified = await verify(await sendLink(email));
        expect(verified.status).toBe(200);
        return cookieJar(getSessionCookie(verified)!);
      };
      const signedInEmail = async (cookie: string) => {
        const session = await callNativeHandler(auth, "/get-session", {
          headers: { cookie },
        });
        return ((await session.json()) as { user?: { email: string } } | null)
          ?.user?.email;
      };
      return { auth, sendLink, verify, signedIn, signedInEmail };
    };

    for (const signInCodes of [false, true]) {
      test(`refuses another account's link and keeps the session and the link (sign-in codes ${signInCodes ? "on" : "off"})`, async () => {
        const app = appSignIns({ signInCodes });
        const current = uniqueEmail("app-current");
        const other = uniqueEmail("app-other");
        const cookie = await app.signedIn(current);
        await app.signedIn(other);
        const token = await app.sendLink(other);

        workspaceLogs.reset();
        const refused = await app.verify(token, cookie);
        expect(refused.status).toBe(403);
        expect(await errorCode(refused)).toBe("ACCOUNT_SWITCH_REFUSED");
        expect(refused.headers.getSetCookie()).toEqual([]);
        expect(await app.signedInEmail(cookie)).toBe(current.toLowerCase());
        const logged = JSON.stringify(workspaceLogs.records());
        expect(logged).toContain("account.native-sign-in.rejected");
        expect(logged).toContain("account-switch");
        expect(logged).not.toContain(token);
        expect(logged).not.toContain(other.toLowerCase());

        // Nothing was consumed: signed out, the same link still signs in.
        const later = await app.verify(token);
        expect(later.status).toBe(200);
        expect(
          await app.signedInEmail(cookieJar(getSessionCookie(later)!))
        ).toBe(other.toLowerCase());
      });
    }

    test("refuses a link that would create a new account", async () => {
      const app = appSignIns();
      const current = uniqueEmail("app-current");
      const cookie = await app.signedIn(current);
      const token = await app.sendLink(uniqueEmail("app-new"));

      const refused = await app.verify(token, cookie);
      expect(refused.status).toBe(403);
      expect(await errorCode(refused)).toBe("ACCOUNT_SWITCH_REFUSED");
      expect(refused.headers.getSetCookie()).toEqual([]);
      expect(await app.signedInEmail(cookie)).toBe(current.toLowerCase());
    });

    test("signs in again with the session account's own link", async () => {
      const app = appSignIns();
      const current = uniqueEmail("app-current");
      const cookie = await app.signedIn(current);

      const verified = await app.verify(await app.sendLink(current), cookie);
      expect(verified.status).toBe(200);
      expect(
        await app.signedInEmail(cookieJar(getSessionCookie(verified)!))
      ).toBe(current.toLowerCase());
    });

    test("answers an unusable link as invalid, not as a switch", async () => {
      const app = appSignIns();
      const cookie = await app.signedIn(uniqueEmail("app-current"));

      const unknown = await app.verify("unknown", cookie);
      expect(unknown.status).toBe(400);
      expect(await errorCode(unknown)).toBe("INVALID_TOKEN");
    });

    test("keeps the redirect for a link that names a callback", async () => {
      const app = appSignIns();
      const cookie = await app.signedIn(uniqueEmail("app-current"));
      const other = uniqueEmail("app-other");
      const token = await app.sendLink(other);

      const redirected = await callHandler(
        app.auth,
        `/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent("/cs-CZ/auth/callback")}`,
        { headers: { cookie } }
      );
      expect(redirected.status).toBe(302);
      expect(
        await app.signedInEmail(cookieJar(getSessionCookie(redirected)!))
      ).toBe(other.toLowerCase());
    });
  });

  test("keeps the redirect for a failed verification that names any callback", async () => {
    const { auth } = makeMemoryTestAuth();
    for (const [name, callback] of [
      ["callbackURL", "/cs-CZ/auth/callback"],
      ["errorCallbackURL", "/cs-CZ/sign-in"],
      ["newUserCallbackURL", "/cs-CZ/account"],
    ] as const) {
      const failed = await callHandler(
        auth,
        `/magic-link/verify?token=unknown&${name}=${encodeURIComponent(callback)}`
      );
      expect(failed.status).toBe(302);
      expect(
        new URL(failed.headers.get("location")!).searchParams.get("error")
      ).toBe("INVALID_TOKEN");
    }
  });
});

describe.skipIf(!testDatabase)("native sign-in handoff", () => {
  test("hands a fresh browser sign-in to the app that holds the verifier, once", async () => {
    const auth = makeTestAuth();
    const { email, cookie } = await signIn(auth);

    const minted = await mintedCode(
      await mint(
        auth,
        {
          code_challenge: rfcChallenge,
          code_challenge_method: "S256",
          state: "app-state-1",
          return_uri: appReturnURI,
        },
        cookie
      )
    );
    expect(`${minted.protocol}//${minted.host}${minted.pathname}`).toBe(
      appReturnURI
    );
    expect(minted.searchParams.get("state")).toBe("app-state-1");
    const code = minted.searchParams.get("code")!;
    expect(code.length).toBeGreaterThanOrEqual(32);

    const redeemed = await exchange(auth, {
      code,
      code_verifier: rfcVerifier,
      return_uri: appReturnURI,
    });
    expect(redeemed.status).toBe(200);
    expect(await sessionEmail(auth, redeemed)).toBe(email.toLowerCase());
    // The app's session is its own; the browser keeps its session.
    expect(cookieJar(getSessionCookie(redeemed)!)).not.toBe(cookie);

    const replayed = await exchange(auth, {
      code,
      code_verifier: rfcVerifier,
      return_uri: appReturnURI,
    });
    expect(replayed.status).toBe(400);
    expect(await errorCode(replayed)).toBe("INVALID_HANDOFF_CODE");
    expect(getSessionCookie(replayed)).toBeUndefined();
  });

  test("refuses a wrong verifier without burning the code", async () => {
    const auth = makeTestAuth();
    const { cookie } = await signIn(auth);
    const pkce = makePkce();
    const code = (
      await mintedCode(
        await mint(
          auth,
          {
            code_challenge: pkce.challenge,
            code_challenge_method: "S256",
            state: "s",
            return_uri: appReturnURI,
          },
          cookie
        )
      )
    ).searchParams.get("code")!;

    workspaceLogs.reset();
    const wrong = await exchange(auth, {
      code,
      code_verifier: makePkce().verifier,
      return_uri: appReturnURI,
    });
    expect(wrong.status).toBe(400);
    expect(await errorCode(wrong)).toBe("INVALID_HANDOFF_CODE");
    expect(getSessionCookie(wrong)).toBeUndefined();
    const logged = JSON.stringify(workspaceLogs.records());
    expect(logged).toContain("account.native-handoff.rejected");
    expect(logged).toContain("verifier-mismatch");
    expect(logged).not.toContain(code);

    const right = await exchange(auth, {
      code,
      code_verifier: pkce.verifier,
      return_uri: appReturnURI,
    });
    expect(right.status).toBe(200);
    expect(getSessionCookie(right)).toBeDefined();
  });

  test("refuses a code redeemed for another return URI", async () => {
    const auth = makeTestAuth();
    const { cookie } = await signIn(auth);
    const pkce = makePkce();
    const code = (
      await mintedCode(
        await mint(
          auth,
          {
            code_challenge: pkce.challenge,
            code_challenge_method: "S256",
            state: "s",
            return_uri: appLinkReturnURI,
          },
          cookie
        )
      )
    ).searchParams.get("code")!;

    for (const return_uri of [appReturnURI, "evil://auth/callback"]) {
      const refused = await exchange(auth, {
        code,
        code_verifier: pkce.verifier,
        return_uri,
      });
      expect(refused.status).toBe(400);
      expect(await errorCode(refused)).toBe("INVALID_HANDOFF_CODE");
    }
    expect(
      (
        await exchange(auth, {
          code,
          code_verifier: pkce.verifier,
          return_uri: appLinkReturnURI,
        })
      ).status
    ).toBe(200);
  });

  test("refuses an expired code", async () => {
    const auth = makeTestAuth();
    const { cookie } = await signIn(auth);
    const pkce = makePkce();
    const code = (
      await mintedCode(
        await mint(
          auth,
          {
            code_challenge: pkce.challenge,
            code_challenge_method: "S256",
            state: "s",
            return_uri: appReturnURI,
          },
          cookie
        )
      )
    ).searchParams.get("code")!;

    setSystemTime(new Date(Date.now() + 3 * 60 * 1000 + 1000));
    const expired = await exchange(auth, {
      code,
      code_verifier: pkce.verifier,
      return_uri: appReturnURI,
    });
    expect(expired.status).toBe(400);
    expect(await errorCode(expired)).toBe("INVALID_HANDOFF_CODE");
  });

  test("redeems a code once when the app sends it twice at the same time", async () => {
    const auth = makeTestAuth();
    const { cookie } = await signIn(auth);
    const pkce = makePkce();
    const code = (
      await mintedCode(
        await mint(
          auth,
          {
            code_challenge: pkce.challenge,
            code_challenge_method: "S256",
            state: "s",
            return_uri: appReturnURI,
          },
          cookie
        )
      )
    ).searchParams.get("code")!;

    const results = await Promise.all(
      [0, 1, 2].map(() =>
        exchange(auth, {
          code,
          code_verifier: pkce.verifier,
          return_uri: appReturnURI,
        })
      )
    );
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 400, 400,
    ]);
  });

  test("refuses an unknown code", async () => {
    const auth = makeTestAuth();
    const refused = await exchange(auth, {
      code: randomBytes(24).toString("base64url"),
      code_verifier: rfcVerifier,
      return_uri: appReturnURI,
    });
    expect(refused.status).toBe(400);
    expect(await errorCode(refused)).toBe("INVALID_HANDOFF_CODE");
  });

  test("mints only for a signed-in browser", async () => {
    const auth = makeTestAuth();
    const refused = await mint(auth, {
      code_challenge: rfcChallenge,
      code_challenge_method: "S256",
      state: "s",
      return_uri: appReturnURI,
    });
    expect(refused.status).toBe(401);
  });

  test("mints only for a session signed in within the last ten minutes", async () => {
    const auth = makeTestAuth();
    const { cookie } = await signIn(auth);
    setSystemTime(new Date(Date.now() + 10 * 60 * 1000 + 1000));

    const refused = await mint(
      auth,
      {
        code_challenge: rfcChallenge,
        code_challenge_method: "S256",
        state: "s",
        return_uri: appReturnURI,
      },
      cookie
    );
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe("SESSION_NOT_FRESH");
  });

  test("mints only for the app's return URIs", async () => {
    const auth = makeTestAuth({
      nativeAppLinkOrigin: "https://app-link.test",
    });
    const { cookie } = await signIn(auth);
    const pkce = makePkce();

    for (const return_uri of [
      "https://app-link.test/app/auth/callback",
      `https://${HOST}/app/auth/callback`,
      "deskohub://auth/callback",
    ]) {
      expect(
        (
          await mint(
            auth,
            {
              code_challenge: pkce.challenge,
              code_challenge_method: "S256",
              state: "s",
              return_uri,
            },
            cookie
          )
        ).status
      ).toBe(200);
    }
    for (const return_uri of [
      "evil://auth/callback",
      "deskohub://account",
      "deskohub://auth/callback?next=x",
      "https://evil.test/app/auth/callback",
      `https://${HOST}/app/account`,
      `https://${HOST}/app/auth/callback#x`,
      `http://${HOST}/app/auth/callback`,
    ]) {
      const refused = await mint(
        auth,
        {
          code_challenge: pkce.challenge,
          code_challenge_method: "S256",
          state: "s",
          return_uri,
        },
        cookie
      );
      expect(refused.status).toBe(400);
      expect(await errorCode(refused)).toBe("INVALID_RETURN_URI");
    }
  });

  test("mints only for an S256 challenge and a bounded state", async () => {
    const auth = makeTestAuth();
    const { cookie } = await signIn(auth);
    const valid = {
      code_challenge: rfcChallenge,
      code_challenge_method: "S256",
      state: "s",
      return_uri: appReturnURI,
    };

    for (const body of [
      { ...valid, code_challenge_method: "plain" },
      { ...valid, code_challenge_method: undefined },
      { ...valid, code_challenge: rfcVerifier.slice(0, 20) },
      { ...valid, code_challenge: `${rfcChallenge.slice(0, 42)}=` },
      { ...valid, state: "" },
      { ...valid, state: "x".repeat(513) },
      { ...valid, state: undefined },
    ]) {
      expect((await mint(auth, body, cookie)).status).toBe(400);
    }
  });

  test("refuses a verifier outside RFC 7636's length and alphabet", async () => {
    const auth = makeTestAuth();
    for (const code_verifier of [
      "a".repeat(42),
      "a".repeat(129),
      `${"a".repeat(42)}+`,
    ]) {
      expect(
        (
          await exchange(auth, {
            code: "x".repeat(32),
            code_verifier,
            return_uri: appReturnURI,
          })
        ).status
      ).toBe(400);
    }
  });

  test("refuses a code once the browser session that minted it signs out", async () => {
    const auth = makeTestAuth();
    const { cookie } = await signIn(auth);
    const pkce = makePkce();
    const code = (
      await mintedCode(
        await mint(
          auth,
          {
            code_challenge: pkce.challenge,
            code_challenge_method: "S256",
            state: "s",
            return_uri: appReturnURI,
          },
          cookie
        )
      )
    ).searchParams.get("code")!;

    expect(
      (
        await callHandler(auth, "/sign-out", {
          method: "POST",
          headers: { cookie },
        })
      ).status
    ).toBe(200);
    const refused = await exchange(auth, {
      code,
      code_verifier: pkce.verifier,
      return_uri: appReturnURI,
    });
    expect(refused.status).toBe(400);
    expect(await errorCode(refused)).toBe("INVALID_HANDOFF_CODE");
  });

  test("keeps the browser sign-in time, so a handoff never refreshes freshness", async () => {
    const auth = makeTestAuth();
    const signedInAt = Date.now();
    const { cookie } = await signIn(auth);
    const handOff = async (sessionCookie: string, native: boolean) => {
      const pkce = makePkce();
      const body = {
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        state: "s",
        return_uri: appReturnURI,
      };
      const minted = native
        ? await callNativeHandler(auth, "/native-handoff/mint", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-vercel-forwarded-for": uniqueIp(),
              cookie: sessionCookie,
            },
            body: JSON.stringify(body),
          })
        : await mint(auth, body, sessionCookie);
      if (minted.status !== 200) return { status: minted.status };
      const redeemed = await exchange(auth, {
        code: (await mintedCode(minted)).searchParams.get("code")!,
        code_verifier: pkce.verifier,
        return_uri: appReturnURI,
      });
      return {
        status: redeemed.status,
        cookie: cookieJar(getSessionCookie(redeemed)!),
      };
    };

    setSystemTime(new Date(signedInAt + 5 * 60 * 1000));
    const app = await handOff(cookie, false);
    expect(app.status).toBe(200);

    // Ten minutes after the browser sign-in, the app's session is as stale
    // as the browser's, and minting from it can't make a fresh one.
    setSystemTime(new Date(signedInAt + 10 * 60 * 1000 + 1000));
    expect((await handOff(app.cookie!, true)).status).toBe(403);
  });

  test("limits exchanges per client IP", async () => {
    const auth = makeTestAuth();
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      statuses.push(
        (
          await exchange(
            auth,
            {
              code: randomBytes(24).toString("base64url"),
              code_verifier: rfcVerifier,
              return_uri: appReturnURI,
            },
            ip
          )
        ).status
      );
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(400));
    expect(statuses[10]).toBe(429);
  });
});

/**
 * The app names its locale on the requests that can create its account,
 * since `/app/` callbacks carry no locale segment.
 */
describe.skipIf(!testDatabase)("app sign-in locale", () => {
  const localeHeader = (locale: string | undefined) =>
    locale === undefined ? {} : { [customerSignInLocaleHeader]: locale };

  const appSignIns = ({ signInCodes = false } = {}) => {
    const sentLinks: CapturedMagicLink[] = [];
    const auth = makeTestAuth({
      sentLinks,
      signInCodeFlag: Effect.succeed(signInCodes),
    });
    const send = async (email: string, callbackURL = "/app/auth/callback") => {
      const sent = await callHandler(auth, "/sign-in/magic-link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vercel-forwarded-for": uniqueIp(),
        },
        body: JSON.stringify({ email, callbackURL }),
      });
      expect(sent.status).toBe(200);
      return sentLinks.at(-1)!;
    };
    const tokenOf = (link: CapturedMagicLink) =>
      new URL(link.url).searchParams.get("token")!;
    /** The native app verifying its App Link. */
    const verifyInApp = (link: CapturedMagicLink, locale?: string) =>
      callNativeHandler(
        auth,
        `/magic-link/verify?token=${encodeURIComponent(tokenOf(link))}`,
        {
          headers: {
            "x-vercel-forwarded-for": uniqueIp(),
            ...localeHeader(locale),
          },
        }
      );
    /** The `/app/` page signing in with the emailed code. */
    const signInWithCode = (
      email: string,
      link: CapturedMagicLink,
      locale?: string
    ) =>
      callHandler(auth, "/sign-in/email-otp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vercel-forwarded-for": uniqueIp(),
          ...localeHeader(locale),
        },
        body: JSON.stringify({ email, otp: link.code }),
      });
    return { auth, send, verifyInApp, signInWithCode };
  };

  const savedLocale = async (email: string) => {
    const id = await userIdForEmail(email);
    expect(id).toBeDefined();
    return (
      await testDatabase!.pool.query<{ locale: string | null }>(
        `select locale from auth."user" where id = $1`,
        [id]
      )
    ).rows[0]?.locale;
  };

  const insertAccountWithoutLocale = (email: string) =>
    workspaceFixtures(testDatabase!.db)
      .account("legacy", { email })
      .pipe(Effect.runPromise);

  test("gives an account the app's App Link creates the app's locale", async () => {
    const { send, verifyInApp } = appSignIns();
    const email = uniqueEmail("app-locale-link");

    const verified = await verifyInApp(await send(email), "cs-CZ");

    expect(verified.status).toBe(200);
    expect(await savedLocale(email)).toBe("cs-CZ");
  });

  test("gives an account the app's sign-in code creates the app's locale", async () => {
    const { send, signInWithCode } = appSignIns({ signInCodes: true });
    const email = uniqueEmail("app-locale-code");
    const link = await send(email);

    const signedIn = await signInWithCode(email, link, "cs-CZ");

    expect(signedIn.status).toBe(200);
    expect(await savedLocale(email)).toBe("cs-CZ");
  });

  test("keeps the default for an app sign-in that names no locale", async () => {
    const { send, verifyInApp } = appSignIns();
    const email = uniqueEmail("app-locale-none");

    expect((await verifyInApp(await send(email))).status).toBe(200);
    expect(await savedLocale(email)).toBe("en-US");
  });

  test("never replaces a saved locale", async () => {
    const { auth, send, verifyInApp } = appSignIns();
    const email = uniqueEmail("app-locale-kept");
    await verifyMagicLink(auth, await send(email, "/en-US/account"));
    expect(await savedLocale(email)).toBe("en-US");

    const verified = await verifyInApp(await send(email), "cs-CZ");

    expect(verified.status).toBe(200);
    expect(await savedLocale(email)).toBe("en-US");
  });

  test("gives an account without a locale the app's at its sign-in", async () => {
    const { send, verifyInApp } = appSignIns();
    const email = uniqueEmail("app-locale-capture");
    await insertAccountWithoutLocale(email);

    expect((await verifyInApp(await send(email), "cs-CZ")).status).toBe(200);
    expect(await savedLocale(email)).toBe("cs-CZ");
  });

  test("takes a localized callback's locale over the app's", async () => {
    const { auth, send } = appSignIns();
    const email = uniqueEmail("app-locale-callback");
    const link = await send(email, "/en-US/account");

    const verified = await callHandler(
      auth,
      link.url.slice(`https://${HOST}/api/auth`.length),
      {
        headers: {
          "x-vercel-forwarded-for": uniqueIp(),
          ...localeHeader("cs-CZ"),
        },
      }
    );

    expect(verified.status).toBe(302);
    expect(await savedLocale(email)).toBe("en-US");
  });

  test("refuses an unsupported locale on the App Link and keeps the link", async () => {
    // With sign-in codes on, the guard claims the link before Better Auth
    // verifies it; the refusal must come first.
    const { send, verifyInApp } = appSignIns({ signInCodes: true });
    const email = uniqueEmail("app-locale-link-refused");
    const link = await send(email);

    for (const locale of ["fr-FR", "cs", "", "cs-CZ,en-US"]) {
      workspaceLogs.reset();
      const refused = await verifyInApp(link, locale);
      expect(refused.status).toBe(400);
      expect(await errorCode(refused)).toBe("INVALID_LOCALE");
      expect(getSessionCookie(refused)).toBeUndefined();
      expect(JSON.stringify(workspaceLogs.records())).toContain(
        "unsupported-locale"
      );
    }
    expect(await userIdForEmail(email)).toBeUndefined();

    expect((await verifyInApp(link, "cs-CZ")).status).toBe(200);
    expect(await savedLocale(email)).toBe("cs-CZ");
  });

  test("refuses an unsupported locale on the sign-in code and keeps the code", async () => {
    const { send, signInWithCode } = appSignIns({ signInCodes: true });
    const email = uniqueEmail("app-locale-code-refused");
    const link = await send(email);

    const refused = await signInWithCode(email, link, "fr-FR");
    expect(refused.status).toBe(400);
    expect(await errorCode(refused)).toBe("INVALID_LOCALE");
    expect(await userIdForEmail(email)).toBeUndefined();

    expect((await signInWithCode(email, link, "cs-CZ")).status).toBe(200);
    expect(await savedLocale(email)).toBe("cs-CZ");
  });
});
