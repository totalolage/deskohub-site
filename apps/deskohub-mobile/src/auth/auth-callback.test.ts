import { describe, expect, test } from "bun:test";
import {
  nativeReturnUri,
  parseAuthCallbackParams,
  parseAuthCallbackUrl,
  withSignInMethod,
} from "./auth-callback";

const token = "tok_abcdefghijklmnopqrstuvwxyz";
const code = "code_0123456789";
const state = "c3RhdGUtdmFsdWUtdGhhdC1pcy1sb25nLWVub3VnaC1mb3ItdGVzdHM";

describe("parseAuthCallbackUrl", () => {
  test("reads a magic-link token from the https App Link", () => {
    expect(
      parseAuthCallbackUrl(
        `https://workspace.deskohub.cz/app/auth/callback?token=${token}`
      )
    ).toEqual({ kind: "token", token });
  });

  test("reads a magic-link token from the app scheme", () => {
    expect(
      parseAuthCallbackUrl(`deskohub://auth/callback?token=${token}`)
    ).toEqual({ kind: "token", token });
  });

  test("reads a handoff code and state from the app scheme", () => {
    expect(
      parseAuthCallbackUrl(
        `${nativeReturnUri}?code=${code}&state=${encodeURIComponent(state)}`
      )
    ).toEqual({ kind: "handoff", code, state });
  });

  test("reads a handoff code and state from the https App Link", () => {
    expect(
      parseAuthCallbackUrl(
        `https://workspace.deskohub.cz/app/auth/callback?code=${code}&state=${state}`
      )
    ).toEqual({ kind: "handoff", code, state });
  });

  test("decodes a URL-encoded state exactly", () => {
    const encoded = "a%2Bb%2Fc%3D";
    expect(
      parseAuthCallbackUrl(`${nativeReturnUri}?code=${code}&state=${encoded}`)
    ).toEqual({ kind: "handoff", code, state: "a+b/c=" });
  });

  test("reports the error a callback carries", () => {
    expect(
      parseAuthCallbackUrl(`${nativeReturnUri}?error=INVALID_TOKEN`)
    ).toEqual({ kind: "error", code: "INVALID_TOKEN" });
  });

  test("reports an error even when credentials come with it", () => {
    expect(
      parseAuthCallbackUrl(
        `${nativeReturnUri}?error=access_denied&code=${code}&state=${state}`
      )
    ).toEqual({ kind: "error", code: "access_denied" });
  });

  test("reduces an unrecognised error to a fixed code", () => {
    expect(
      parseAuthCallbackUrl(`${nativeReturnUri}?error=${"x".repeat(200)}`)
    ).toEqual({ kind: "error", code: "unknown" });
    expect(
      parseAuthCallbackUrl(`${nativeReturnUri}?error=has%20spaces`)
    ).toEqual({ kind: "error", code: "unknown" });
  });

  test("refuses a callback without credentials", () => {
    expect(parseAuthCallbackUrl(nativeReturnUri)).toEqual({ kind: "invalid" });
    expect(parseAuthCallbackUrl(`${nativeReturnUri}?token=`)).toEqual({
      kind: "invalid",
    });
  });

  test("refuses a handoff code without its state, or a state alone", () => {
    expect(parseAuthCallbackUrl(`${nativeReturnUri}?code=${code}`)).toEqual({
      kind: "invalid",
    });
    expect(parseAuthCallbackUrl(`${nativeReturnUri}?state=${state}`)).toEqual({
      kind: "invalid",
    });
  });

  test("refuses duplicate parameters", () => {
    expect(
      parseAuthCallbackUrl(`${nativeReturnUri}?token=${token}&token=other`)
    ).toEqual({ kind: "invalid" });
    expect(
      parseAuthCallbackUrl(
        `${nativeReturnUri}?code=${code}&code=${code}&state=${state}`
      )
    ).toEqual({ kind: "invalid" });
    expect(
      parseAuthCallbackUrl(
        `${nativeReturnUri}?code=${code}&state=${state}&state=${state}`
      )
    ).toEqual({ kind: "invalid" });
  });

  test("refuses a token mixed with a handoff code", () => {
    expect(
      parseAuthCallbackUrl(
        `${nativeReturnUri}?token=${token}&code=${code}&state=${state}`
      )
    ).toEqual({ kind: "invalid" });
  });

  test("refuses other paths, hosts and schemes", () => {
    for (const url of [
      `https://workspace.deskohub.cz/auth/callback?token=${token}`,
      `https://workspace.deskohub.cz/app/auth/callback/extra?token=${token}`,
      `https://workspace.deskohub.cz/api/auth/magic-link/verify?token=${token}`,
      `deskohub://account?token=${token}`,
      `evil://auth/callback?token=${token}`,
      `http://workspace.deskohub.cz/app/auth/callback?token=${token}`,
      "not a url",
    ]) {
      expect(parseAuthCallbackUrl(url)).toEqual({ kind: "invalid" });
    }
  });
});

describe("sign-in method on a handoff", () => {
  test("round-trips the method the web page adds", () => {
    const minted = `${nativeReturnUri}?code=${code}&state=${state}`;
    for (const method of ["link", "code", "passkey", "continue"] as const) {
      expect(parseAuthCallbackUrl(withSignInMethod(minted, method))).toEqual({
        kind: "handoff",
        code,
        state,
        method,
      });
    }
  });

  test("leaves out a missing or unknown method", () => {
    expect(
      parseAuthCallbackUrl(
        `${nativeReturnUri}?code=${code}&state=${state}&method=other`
      )
    ).toEqual({ kind: "handoff", code, state });
  });
});

describe("parseAuthCallbackParams", () => {
  test("reads the route's search params", () => {
    expect(parseAuthCallbackParams({ token })).toEqual({
      kind: "token",
      token,
    });
    expect(parseAuthCallbackParams({ code, state })).toEqual({
      kind: "handoff",
      code,
      state,
    });
    expect(parseAuthCallbackParams({ error: "OTP_EXPIRED" })).toEqual({
      kind: "error",
      code: "OTP_EXPIRED",
    });
  });

  test("refuses a parameter the router collected more than once", () => {
    expect(parseAuthCallbackParams({ token: [token, token] })).toEqual({
      kind: "invalid",
    });
  });

  test("ignores unrelated route params", () => {
    expect(parseAuthCallbackParams({ token, utm_source: "mail" })).toEqual({
      kind: "token",
      token,
    });
    expect(parseAuthCallbackParams({})).toEqual({ kind: "invalid" });
  });
});
