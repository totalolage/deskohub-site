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

describe("toAuthSessionState locale", () => {
  test("keeps the account's saved locale when the app supports it", () => {
    expect(
      toAuthSessionState({
        data: { user: { ...user, locale: "de-DE" }, session: session.session },
        isPending: false,
      })
    ).toEqual({ status: "signed-in", user, signedInAt, locale: "de-DE" });
  });

  test("has no locale when none is saved or the app doesn't support it", () => {
    for (const locale of [null, undefined, "fr-FR", "de", ""]) {
      const state = toAuthSessionState({
        data: { user: { ...user, locale }, session: session.session },
        isPending: false,
      });
      expect(state).toEqual({ status: "signed-in", user, signedInAt });
      expect(state.status === "signed-in" && "locale" in state).toBe(false);
    }
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
  test("keeps an in-app path with its query", () => {
    expect(safeReturnPath("/account/passkeys")).toBe("/account/passkeys");
    expect(safeReturnPath("/account?tab=x")).toBe("/account?tab=x");
  });

  test("refuses anything that isn't a plain in-app route", () => {
    for (const value of [
      undefined,
      ["/account"],
      "",
      "account",
      "//evil.test",
      "/\\evil.test",
      "https://evil.test",
      "javascript:alert(1)",
      // Browsers strip tabs and newlines, which leaves "//evil.test".
      "/\t/evil.test",
      "/\n/evil.test",
      "/ /evil.test",
      "/a/../sign-in",
      "/sign-in",
      "/sign-in/",
      "/sign-in?x=1",
      "/auth//callback",
      "/auth/callback",
      "/auth/callback#token",
    ]) {
      expect(safeReturnPath(value)).toBe("/");
    }
  });
});
