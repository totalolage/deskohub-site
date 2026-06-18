import { describe, expect, test } from "bun:test";
import {
  createPostHogSessionClearCookieStrings,
  createPostHogSessionCookieStrings,
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "./posthog-session-cookies";

describe("PostHog session cookies", () => {
  test("creates first-party cookies for PostHog log linking", () => {
    expect(
      createPostHogSessionCookieStrings({
        distinctId: "user id",
        sessionId: "session/id",
      })
    ).toEqual([
      `${POSTHOG_DISTINCT_ID_COOKIE}=user%20id; Path=/; Max-Age=31536000; SameSite=Lax`,
      `${POSTHOG_SESSION_ID_COOKIE}=session%2Fid; Path=/; Max-Age=86400; SameSite=Lax`,
    ]);
  });

  test("creates expiry cookies when analytics consent is revoked", () => {
    expect(createPostHogSessionClearCookieStrings()).toEqual([
      `${POSTHOG_DISTINCT_ID_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`,
      `${POSTHOG_SESSION_ID_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`,
    ]);
  });
});
