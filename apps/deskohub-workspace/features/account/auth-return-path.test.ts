import { describe, expect, test } from "bun:test";
import {
  authReturnPathParam,
  encodeAuthCallbackReturnPath,
  parseAuthReturnPath,
  readAuthCallbackReturnPath,
  withAuthReturnPath,
} from "./auth-return-path";

describe("auth return path", () => {
  test.each([
    "/en-US/account",
    "/cs-CZ/reservation?date=2026-10-20&contact=a.b.c.d",
    "/en-US",
  ])("accepts the site page %s with its query", (candidate) => {
    expect(parseAuthReturnPath(candidate)).toBe(candidate);
  });

  test.each([
    "https://evil.example/en-US/account",
    "//evil.example/en-US/account",
    "/\\evil.example/en-US",
    "/de-DE/account",
    "/account",
    "/api/auth/sign-out",
    "/en-US/auth/sign-in",
    "/en-US/auth/verify?returnTo=%2Fen-US%2Faccount",
    "/en-US/%61uth/callback",
    "/en-US/AUTH/callback",
    "/en-US/x/../auth/callback",
    "/en-US/%E0%A4%A",
  ])("rejects %s", (candidate) => {
    expect(parseAuthReturnPath(candidate)).toBeUndefined();
  });

  test("rejects a path too long to ride in the sign-in email", () => {
    expect(
      parseAuthReturnPath(`/en-US/reservation?state=${"a".repeat(2048)}`)
    ).toBeUndefined();
  });

  test("appends the return path as one encoded parameter", () => {
    const path = withAuthReturnPath(
      "/en-US/auth/sign-in",
      "/en-US/reservation?date=2026-10-20&seat=a"
    );
    const url = new URL(path, "https://site.invalid");

    expect(url.pathname).toBe("/en-US/auth/sign-in");
    expect([...url.searchParams.keys()]).toEqual([authReturnPathParam]);
    expect(url.searchParams.get(authReturnPathParam)).toBe(
      "/en-US/reservation?date=2026-10-20&seat=a"
    );
    expect(withAuthReturnPath("/en-US/auth/sign-in", undefined)).toBe(
      "/en-US/auth/sign-in"
    );
  });

  test("round-trips a return path through the callback encoding", () => {
    const path = "/en-US/reservation?date=2026-10-20&contact=a.b-c_d";
    const encoded = encodeAuthCallbackReturnPath(path);

    expect(encoded).toMatch(/^[\w-]+$/);
    expect(readAuthCallbackReturnPath(encoded)).toBe(path);
  });

  test.each([null, undefined, "", "not base64url!", "L2VuLVVTL2FjY291bnQ="])(
    "reads the malformed callback return %p as absent",
    (encoded) => {
      expect(readAuthCallbackReturnPath(encoded)).toBeUndefined();
    }
  );

  test("validates a decoded callback return path again", () => {
    expect(
      readAuthCallbackReturnPath(
        encodeAuthCallbackReturnPath("//evil.example/en-US/account")
      )
    ).toBeUndefined();
    expect(
      readAuthCallbackReturnPath(
        encodeAuthCallbackReturnPath("/en-US/auth/sign-in")
      )
    ).toBeUndefined();
  });
});
