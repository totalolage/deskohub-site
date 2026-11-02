import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  withAnonymousVisitor,
  withWorkspaceRequestContext,
} from "@/shared/backend/workspace-request-context";
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
const globalReleaseSubject = {
  distinctId: "deskohub-workspace:global-release",
  sendFeatureFlagEvents: false,
};

const subjectFor = async (
  provide: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>
) => {
  const { getCurrentPostHogFeatureFlagSubject } = await import("./subject");
  return Effect.runPromise(provide(getCurrentPostHogFeatureFlagSubject()));
};

describe("PostHog feature flag subject", () => {
  test("uses the consented visitor of the request and records flag access", async () => {
    const subject = await subjectFor(
      withWorkspaceRequestContext(
        new Headers({
          cookie: `${analyticsConsentCookie}; ${POSTHOG_DISTINCT_ID_COOKIE}=cookie-id; ${POSTHOG_SESSION_ID_COOKIE}=session-id`,
          "X-POSTHOG-DISTINCT-ID": "current-visitor-id",
          "X-POSTHOG-SESSION-ID": "current-session-id",
        })
      )
    );

    expect(subject).toEqual({
      distinctId: "current-visitor-id",
      sendFeatureFlagEvents: true,
    });
  });

  test("uses a non-recording global subject without analytics consent", async () => {
    const subject = await subjectFor(
      withWorkspaceRequestContext(
        new Headers({
          cookie: `${necessaryConsentCookie}; ${POSTHOG_DISTINCT_ID_COOKIE}=stale-id; ${POSTHOG_SESSION_ID_COOKIE}=stale-session`,
        })
      )
    );

    expect(subject).toEqual(globalReleaseSubject);
  });

  test("uses the global subject for work that serves no visitor", async () => {
    expect(await subjectFor(withAnonymousVisitor)).toEqual(
      globalReleaseSubject
    );
  });
});
