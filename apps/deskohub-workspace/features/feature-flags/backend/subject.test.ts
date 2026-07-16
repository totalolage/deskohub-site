import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";

const analyticsConsentCookie = `cc_cookie=${encodeURIComponent(
  JSON.stringify({ categories: ["necessary", "analytics"] })
)}`;
const necessaryConsentCookie = `cc_cookie=${encodeURIComponent(
  JSON.stringify({ categories: ["necessary"] })
)}`;

describe("PostHog feature flag subject", () => {
  test("uses the consented PostHog visitor identity and records flag access", async () => {
    const { getPostHogFeatureFlagSubjectFromRequestHeaders } = await import(
      "./subject"
    );
    const subject = getPostHogFeatureFlagSubjectFromRequestHeaders(
      new Headers({
        cookie: `${analyticsConsentCookie}; ${POSTHOG_DISTINCT_ID_COOKIE}=cookie-id; ${POSTHOG_SESSION_ID_COOKIE}=session-id`,
        "X-POSTHOG-DISTINCT-ID": "current-visitor-id",
        "X-POSTHOG-SESSION-ID": "current-session-id",
      })
    );

    expect(subject).toEqual({
      distinctId: "current-visitor-id",
      sendFeatureFlagEvents: true,
    });
  });

  test("uses a non-recording global subject without analytics consent", async () => {
    const { getPostHogFeatureFlagSubjectFromRequestHeaders } = await import(
      "./subject"
    );
    const subject = getPostHogFeatureFlagSubjectFromRequestHeaders(
      new Headers({
        cookie: `${necessaryConsentCookie}; ${POSTHOG_DISTINCT_ID_COOKIE}=stale-id; ${POSTHOG_SESSION_ID_COOKIE}=stale-session`,
      })
    );

    expect(subject).toEqual({
      distinctId: "deskohub-workspace:global-release",
      sendFeatureFlagEvents: false,
    });
  });

  test("uses a non-recording global subject before PostHog initializes", async () => {
    const { getPostHogFeatureFlagSubjectFromRequestHeaders } = await import(
      "./subject"
    );
    expect(
      getPostHogFeatureFlagSubjectFromRequestHeaders(new Headers())
    ).toEqual({
      distinctId: "deskohub-workspace:global-release",
      sendFeatureFlagEvents: false,
    });
  });
});
