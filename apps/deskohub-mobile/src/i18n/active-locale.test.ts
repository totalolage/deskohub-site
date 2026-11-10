import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { AuthSessionState } from "../auth/auth-session-state";
import { toAuthSessionState } from "../auth/auth-session-state";
import {
  activeLocale,
  localeOverride,
  overrideFor,
  sessionUserId,
} from "./active-locale";
import type { AppLocale } from "./app-locale";

const signedInAt = new Date(Date.UTC(2026, 10, 9, 12));
const signedIn = (userId: string, locale?: AppLocale): AuthSessionState => ({
  status: "signed-in",
  user: { id: userId, email: testEmailAddress(userId) },
  signedInAt,
  ...(locale ? { locale } : {}),
});
const ada = (locale?: AppLocale) => signedIn("ada", locale);
const launchLocale = "cs-CZ";

describe("activeLocale without a choice in the app", () => {
  test("is the account's saved locale while signed in", () => {
    expect(
      activeLocale({ session: ada("de-DE"), sessionReads: 1, launchLocale })
    ).toBe("de-DE");
  });

  test("is the launch locale without a saved locale or a session", () => {
    for (const session of [
      ada(),
      { status: "signed-out" } as const,
      { status: "restoring" } as const,
    ]) {
      expect(activeLocale({ session, sessionReads: 1, launchLocale })).toBe(
        "cs-CZ"
      );
    }
  });

  test("is the launch locale for a saved locale the app doesn't ship", () => {
    const session = toAuthSessionState({
      data: {
        user: { id: "ada", email: testEmailAddress("ada"), locale: "fr-FR" },
        session: { createdAt: signedInAt },
      },
      isPending: false,
    });
    expect(activeLocale({ session, sessionReads: 1, launchLocale })).toBe(
      "cs-CZ"
    );
  });
});

describe("activeLocale after a choice in the app", () => {
  // Ada's account saved German; she picks Slovak and the save succeeds after
  // two completed session reads.
  const override = localeOverride(sessionUserId(ada("de-DE")), "sk-SK", 2);

  test("shows the choice while no later session read has completed", () => {
    expect(
      activeLocale({
        session: ada("de-DE"),
        sessionReads: 2,
        launchLocale,
        override,
      })
    ).toBe("sk-SK");
  });

  test("keeps the choice over a stale read or a failed refetch", () => {
    // A read that completed before the save is in the save's count, and a
    // failed read isn't counted (session-reads.test.ts): the session still
    // carries German at the save's count.
    expect(
      activeLocale({
        session: ada("de-DE"),
        sessionReads: 2,
        launchLocale,
        override,
      })
    ).toBe("sk-SK");
  });

  test("hands over to the session once a later read completes", () => {
    expect(
      activeLocale({
        session: ada("sk-SK"),
        sessionReads: 3,
        launchLocale,
        override,
      })
    ).toBe("sk-SK");
  });

  test("follows a later change made on the web, even back to the old value", () => {
    expect(
      activeLocale({
        session: ada("de-DE"),
        sessionReads: 4,
        launchLocale,
        override,
      })
    ).toBe("de-DE");
  });

  test("doesn't carry over to another account with the same saved locale", () => {
    expect(
      activeLocale({
        session: signedIn("grace", "de-DE"),
        sessionReads: 2,
        launchLocale,
        override,
      })
    ).toBe("de-DE");
    expect(
      activeLocale({
        session: signedIn("grace"),
        sessionReads: 2,
        launchLocale,
        override,
      })
    ).toBe("cs-CZ");
  });

  test("ends on sign-out", () => {
    expect(
      activeLocale({
        session: { status: "signed-out" },
        sessionReads: 2,
        launchLocale,
        override,
      })
    ).toBe("cs-CZ");
  });
});

describe("localeOverride", () => {
  test("needs a signed-in account", () => {
    expect(
      localeOverride(sessionUserId({ status: "signed-out" }), "sk-SK", 0)
    ).toBeUndefined();
  });
});

describe("overrideFor", () => {
  const override = localeOverride("ada", "sk-SK", 2);

  test("keeps the choice while its account stays signed in", () => {
    expect(overrideFor(override, "ada")).toBe(override);
  });

  test("drops the choice once its account signs out or another signs in", () => {
    expect(overrideFor(override, undefined)).toBeUndefined();
    expect(overrideFor(override, "grace")).toBeUndefined();
  });

  test("doesn't bring a dropped choice back when the account returns", () => {
    // Ada signs out (the hook keeps what overrideFor returns), then back in
    // before any read completes.
    const afterSignOut = overrideFor(override, undefined);
    expect(
      activeLocale({
        session: ada("de-DE"),
        sessionReads: 2,
        launchLocale,
        override: overrideFor(afterSignOut, "ada"),
      })
    ).toBe("de-DE");
  });
});
