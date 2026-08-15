import "server-only";

import type { PostHogFeatureFlagSubject } from "@deskohub/posthog/feature-flags/node";
import { PostHogDistinctId } from "@deskohub/posthog/identifiers";

export const workspaceReleaseSubject = {
  distinctId: PostHogDistinctId.make("deskohub-workspace:global-release"),
  sendFeatureFlagEvents: false,
} as const satisfies PostHogFeatureFlagSubject;
