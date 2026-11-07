import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  isFreshSignIn,
  isReauthenticationRequired,
  safeReturnPath,
  toAuthSessionState,
} from "./auth-session-state";

const user = { id: "user-ada", email: testEmailAddress("ada") };
const signedInAt = new Date(Date.UTC(2026, 10, 7, 12));
const session = { user, session: { createdAt: signedInAt } };

describe("toAuthSessionState", () => {
  test("restores while the first read is pending", () => {
    expect(toAuthSessionState({ data: null, isPending: true })).toEqual({
      status: "restoring",
    });
  });

  test("is signed in with session data, even while it refreshes", () => {
    const signedIn = { status: "signed-in", user, signedInAt } as const;
    expect(toAuthSessionState({ data: session, isPending: false })).toEqual(
      signedIn
    );
    expect(toAuthSessionState({ data: session, isPending: true })).toEqual(
      signedIn
    );
  });

  test("is signed out once the read settles without a session", () => {
    expect(toAuthSessionState({ data: null, isPending: false })).toEqual({
      status: "signed-out",
    });
    expect(toAuthSessionState({ data: undefined, isPending: false })).toEqual({
      status: "signed-out",
    });
  });

  test("reads a serialized sign-in time", () => {
    expect(
      toAuthSessionState({
        data: { user, session: { createdAt: signedInAt.toISOString() } },
        isPending: false,
      })
    ).toEqual({ status: "signed-in", user, signedInAt });
  });
});

describe("isFreshSignIn", () => {
  test("leaves a minute of the server's ten for the next request", () => {
    const now = signedInAt.getTime();
    expect(isFreshSignIn(signedInAt, now + 8 * 60 * 1000)).toBe(true);
    expect(isFreshSignIn(signedInAt, now + 9 * 60 * 1000)).toBe(false);
  });
});

describe("isReauthenticationRequired", () => {
  test("matches the server's fresh-session refusals", () => {
    expect(
      isReauthenticationRequired({ status: 403, code: "SESSION_NOT_FRESH" })
    ).toBe(true);
    expect(isReauthenticationRequired({ code: "SESSION_EXPIRED" })).toBe(true);
    expect(
      isReauthenticationRequired({ status: 401, code: "UNAUTHORIZED" })
    ).toBe(false);
    expect(isReauthenticationRequired(null)).toBe(false);
    expect(isReauthenticationRequired("SESSION_NOT_FRESH")).toBe(false);
  });
});

describe("safeReturnPath", () => {
  test("keeps an in-app path and refuses anything else", () => {
    expect(safeReturnPath("/account/passkeys")).toBe("/account/passkeys");
    expect(safeReturnPath(["/account"])).toBe("/");
    for (const value of [
      undefined,
      "",
      "account",
      "//evil.test",
      "/\\evil.test",
      "https://evil.test",
      "/auth/callback",
      "/sign-in",
    ]) {
      expect(safeReturnPath(value)).toBe("/");
    }
  });
});
