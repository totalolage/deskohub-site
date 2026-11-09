import { describe, expect, test } from "bun:test";
import { Effect, Logger } from "effect";
import { savedConsentCookieValue } from "@/shared/testing/consent-cookie.test-utils";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";
import { readVisitorIdentity } from "./visitor-identity";

const consentCookie = (categories: readonly unknown[]) =>
  `cc_cookie=${savedConsentCookieValue({ categories })}`;
const analyticsConsentCookie = consentCookie(["necessary", "analytics"]);
const necessaryConsentCookie = consentCookie(["necessary"]);
const visitorCookies = `${POSTHOG_DISTINCT_ID_COOKIE}=cookie-distinct-id; ${POSTHOG_SESSION_ID_COOKIE}=cookie-session-id`;
const tracingHeaders = {
  "X-POSTHOG-DISTINCT-ID": "header-distinct-id",
  "X-POSTHOG-SESSION-ID": "header-session-id",
};

const read = (headers: Record<string, string>) => {
  const warnings: unknown[][] = [];
  const identity = readVisitorIdentity(new Headers(headers)).pipe(
    Effect.provide(
      Logger.layer([
        Logger.make(({ logLevel, message }) => {
          if (logLevel === "Warn") warnings.push(message as unknown[]);
        }),
      ])
    ),
    Effect.runSync
  );
  return { identity, warnings };
};

describe("readVisitorIdentity", () => {
  test("reads the visitor from first-party PostHog cookies", () => {
    expect(
      read({
        cookie: `${analyticsConsentCookie}; other=ignored; ${POSTHOG_DISTINCT_ID_COOKIE}=user%20id; ${POSTHOG_SESSION_ID_COOKIE}=session%2Fid`,
      }).identity
    ).toEqual({ distinctId: "user id", sessionId: "session/id" });
  });

  test("ignores empty PostHog cookie identifiers", () => {
    expect(
      read({
        cookie: `${analyticsConsentCookie}; ${POSTHOG_DISTINCT_ID_COOKIE}=; ${POSTHOG_SESSION_ID_COOKIE}=`,
      }).identity
    ).toEqual({});
  });

  test("ignores tracing headers without both first-party cookies", () => {
    expect(
      read({ cookie: analyticsConsentCookie, ...tracingHeaders }).identity
    ).toEqual({});
    expect(
      read({
        cookie: `${analyticsConsentCookie}; ${POSTHOG_DISTINCT_ID_COOKIE}=cookie-distinct-id`,
        ...tracingHeaders,
      }).identity
    ).toEqual({ distinctId: "cookie-distinct-id" });
  });

  test("keeps the cookie identifiers when tracing headers are absent or empty", () => {
    const cookie = `${analyticsConsentCookie}; ${visitorCookies}`;
    const cookieIdentity = {
      distinctId: "cookie-distinct-id",
      sessionId: "cookie-session-id",
    };

    expect(read({ cookie }).identity).toEqual(cookieIdentity);
    expect(
      read({
        cookie,
        "X-POSTHOG-DISTINCT-ID": "",
        "X-POSTHOG-SESSION-ID": "",
      }).identity
    ).toEqual(cookieIdentity);
  });

  test("prefers tracing headers over cookies", () => {
    expect(
      read({
        cookie: `${analyticsConsentCookie}; ${visitorCookies}`,
        ...tracingHeaders,
      }).identity
    ).toEqual({
      distinctId: "header-distinct-id",
      sessionId: "header-session-id",
    });
  });

  test("stays anonymous without analytics consent", () => {
    expect(
      read({ cookie: visitorCookies, ...tracingHeaders }).identity
    ).toEqual({});
    expect(
      read({
        cookie: `${necessaryConsentCookie}; ${visitorCookies}`,
        ...tracingHeaders,
      }).identity
    ).toEqual({});
  });

  test("stays anonymous when any copy of the consent cookie declines analytics", () => {
    expect(
      read({
        cookie: `${analyticsConsentCookie}; ${necessaryConsentCookie}; ${visitorCookies}`,
        ...tracingHeaders,
      }).identity
    ).toEqual({});
  });

  test("stays anonymous for a malformed consent cookie and warns once per read", () => {
    const { identity, warnings } = read({
      cookie: `${consentCookie(["analytics", 123])}; ${visitorCookies}`,
      ...tracingHeaders,
    });

    expect(identity).toEqual({});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContainEqual({
      reasons: ["invalid_category_type"],
    });
  });

  test("logs nothing for a well-formed consent cookie", () => {
    expect(
      read({ cookie: `${analyticsConsentCookie}; ${visitorCookies}` }).warnings
    ).toEqual([]);
  });
});
