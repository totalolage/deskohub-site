import "server-only";

import type { PostHogFeatureFlagSubject } from "@deskohub/posthog/feature-flags/node";
import { PostHogDistinctId } from "@deskohub/posthog/identifiers";
import { Effect } from "effect";
import { currentVisitorIdentity } from "@/shared/backend/workspace-request-context";

const workspaceReleaseSubject = {
  distinctId: PostHogDistinctId.make("deskohub-workspace:global-release"),
  sendFeatureFlagEvents: false,
} as const satisfies PostHogFeatureFlagSubject;

/**
 * The consented visitor of the request being served, or a non-recording
 * global subject for an anonymous visitor or a run outside any request.
 */
export const getCurrentPostHogFeatureFlagSubject = Effect.fn(
  "getCurrentPostHogFeatureFlagSubject"
)(() =>
  currentVisitorIdentity.pipe(
    Effect.map(
      ({ distinctId }): PostHogFeatureFlagSubject =>
        distinctId
          ? { distinctId, sendFeatureFlagEvents: true }
          : workspaceReleaseSubject
    ),
    Effect.catch((error) =>
      Effect.logWarning(error.message, { cause: error.cause }).pipe(
        Effect.as(workspaceReleaseSubject)
      )
    )
  )
);
