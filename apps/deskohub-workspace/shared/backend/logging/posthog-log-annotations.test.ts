import { describe, expect, test } from "bun:test";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";
import {
  getPostHogLogAnnotationsFromCookieHeader,
  getPostHogLogAnnotationsFromCookieValues,
  getPostHogLogAnnotationsFromRequestHeaders,
} from "./posthog-log-annotations";

describe("PostHog log annotations", () => {
  test("maps cookie values to PostHog log-linking attributes", () => {
    expect(
      getPostHogLogAnnotationsFromCookieValues({
        distinctId: "distinct-id",
        sessionId: "session-id",
      })
    ).toEqual({
      posthogDistinctId: "distinct-id",
      sessionId: "session-id",
    });
  });

  test("parses first-party PostHog cookies from a request cookie header", () => {
    expect(
      getPostHogLogAnnotationsFromCookieHeader(
        `other=ignored; ${POSTHOG_DISTINCT_ID_COOKIE}=user%20id; ${POSTHOG_SESSION_ID_COOKIE}=session%2Fid`
      )
    ).toEqual({
      posthogDistinctId: "user id",
      sessionId: "session/id",
    });
  });

  test("returns no annotations without PostHog cookies", () => {
    expect(getPostHogLogAnnotationsFromCookieHeader("other=value")).toEqual({});
  });

  test("parses PostHog tracing headers from request headers", () => {
    expect(
      getPostHogLogAnnotationsFromRequestHeaders(
        new Headers({
          "X-POSTHOG-DISTINCT-ID": "header-distinct-id",
          "X-POSTHOG-SESSION-ID": "header-session-id",
        })
      )
    ).toEqual({
      posthogDistinctId: "header-distinct-id",
      sessionId: "header-session-id",
    });
  });

  test("uses cookies as fallback when tracing headers are absent", () => {
    expect(
      getPostHogLogAnnotationsFromRequestHeaders(
        new Headers({
          cookie: `${POSTHOG_DISTINCT_ID_COOKIE}=cookie-distinct-id; ${POSTHOG_SESSION_ID_COOKIE}=cookie-session-id`,
        })
      )
    ).toEqual({
      posthogDistinctId: "cookie-distinct-id",
      sessionId: "cookie-session-id",
    });
  });

  test("prefers tracing headers over cookies", () => {
    expect(
      getPostHogLogAnnotationsFromRequestHeaders(
        new Headers({
          cookie: `${POSTHOG_DISTINCT_ID_COOKIE}=cookie-distinct-id; ${POSTHOG_SESSION_ID_COOKIE}=cookie-session-id`,
          "X-POSTHOG-DISTINCT-ID": "header-distinct-id",
          "X-POSTHOG-SESSION-ID": "header-session-id",
        })
      )
    ).toEqual({
      posthogDistinctId: "header-distinct-id",
      sessionId: "header-session-id",
    });
  });
});
