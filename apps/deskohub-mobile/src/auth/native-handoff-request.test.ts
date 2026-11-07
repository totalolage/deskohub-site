import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { nativeReturnUri } from "./auth-callback";
import {
  nativeHandoffRequestTtlMs,
  nativeSignInUrl,
  readNativeHandoffRequest,
  restoreNativeHandoffRequest,
  serializeNativeHandoffRequest,
  withoutCallbackCredentials,
  withoutNativeRequestParams,
} from "./native-handoff-request";

const origin = "https://workspace.deskohub.cz";
const codeChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const state = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const request = {
  codeChallenge,
  state,
  returnUri: nativeReturnUri,
  reauthenticate: false,
};

const searchOf = (url: string) => new URL(url).searchParams;

describe("native sign-in URL", () => {
  test("round-trips through the web page's reader", () => {
    const url = nativeSignInUrl(origin, request);
    expect(new URL(url).pathname).toBe("/app/sign-in");
    expect(readNativeHandoffRequest(searchOf(url), origin)).toEqual(
      Option.some(request)
    );
  });

  test("carries the reauthentication prompt", () => {
    const url = nativeSignInUrl(origin, { ...request, reauthenticate: true });
    expect(searchOf(url).get("prompt")).toBe("login");
    expect(readNativeHandoffRequest(searchOf(url), origin)).toEqual(
      Option.some({ ...request, reauthenticate: true })
    );
  });
});

describe("readNativeHandoffRequest", () => {
  const valid = () =>
    new URLSearchParams({
      native: "1",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      return_uri: nativeReturnUri,
    });

  test("ignores a page opened without native=1", () => {
    const search = valid();
    search.delete("native");
    expect(readNativeHandoffRequest(search, origin)).toEqual(Option.none());
  });

  test("accepts the site's own https callback as the return URI", () => {
    const search = valid();
    search.set("return_uri", `${origin}/app/auth/callback`);
    expect(readNativeHandoffRequest(search, origin)).toEqual(
      Option.some({ ...request, returnUri: `${origin}/app/auth/callback` })
    );
  });

  test("refuses another return URI", () => {
    for (const returnUri of [
      "https://evil.test/app/auth/callback",
      `${origin}/app/auth/callback?x=1`,
      "deskohub://account",
      "evil://auth/callback",
    ]) {
      const search = valid();
      search.set("return_uri", returnUri);
      expect(readNativeHandoffRequest(search, origin)).toEqual(Option.none());
    }
  });

  test("refuses a malformed challenge, method or state", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["code_challenge", codeChallenge.slice(1)],
      ["code_challenge", `${codeChallenge.slice(1)}=`],
      ["code_challenge_method", "plain"],
      ["state", "short"],
      ["state", `${state.slice(1)}+`],
      ["state", "a".repeat(513)],
    ];
    for (const [name, value] of cases) {
      const search = valid();
      search.set(name, value);
      expect(readNativeHandoffRequest(search, origin)).toEqual(Option.none());
    }
  });

  test("refuses duplicated parameters", () => {
    const search = valid();
    search.append("state", state);
    expect(readNativeHandoffRequest(search, origin)).toEqual(Option.none());
  });
});

describe("stored native handoff request", () => {
  const now = Date.UTC(2026, 10, 7, 12);

  test("restores before it expires", () => {
    const raw = serializeNativeHandoffRequest(request, now);
    expect(
      restoreNativeHandoffRequest(raw, now + nativeHandoffRequestTtlMs - 1)
    ).toEqual(Option.some(request));
  });

  test("expires within ten minutes", () => {
    expect(nativeHandoffRequestTtlMs).toBeLessThanOrEqual(10 * 60 * 1000);
    const raw = serializeNativeHandoffRequest(request, now);
    expect(
      restoreNativeHandoffRequest(raw, now + nativeHandoffRequestTtlMs)
    ).toEqual(Option.none());
  });

  test("reads absent or malformed storage as none", () => {
    expect(restoreNativeHandoffRequest(null, now)).toEqual(Option.none());
    expect(restoreNativeHandoffRequest("{", now)).toEqual(Option.none());
    expect(
      restoreNativeHandoffRequest(
        JSON.stringify({ request: { state }, expiresAt: now + 1000 }),
        now
      )
    ).toEqual(Option.none());
  });
});

describe("URL stripping", () => {
  test("drops the native request params and keeps the rest", () => {
    const url = `${nativeSignInUrl(origin, { ...request, reauthenticate: true })}&lang=cs#top`;
    expect(withoutNativeRequestParams(url)).toBe("/app/sign-in?lang=cs#top");
  });

  test("drops callback credentials and keeps the path", () => {
    expect(
      withoutCallbackCredentials(
        `${origin}/app/auth/callback?token=t&code=c&state=s&error=e&utm=x`
      )
    ).toBe("/app/auth/callback?utm=x");
    expect(withoutCallbackCredentials(`${origin}/app/auth/callback`)).toBe(
      "/app/auth/callback"
    );
  });
});
