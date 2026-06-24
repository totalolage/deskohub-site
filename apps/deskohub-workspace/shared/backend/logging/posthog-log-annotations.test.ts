import { describe, expect, test } from "bun:test";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";
import {
  getPostHogLogAnnotationsFromCookieHeader,
  getPostHogLogAnnotationsFromCookieValues,
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
});
