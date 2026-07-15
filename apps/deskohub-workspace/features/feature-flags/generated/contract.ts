import { definePostHogFeatureFlags } from "@deskohub/posthog/feature-flags";

/** Generated from PostHog feature flag definitions. Do not edit manually. */
export const postHogFeatureFlags = definePostHogFeatureFlags<
  PostHogFeatureFlagDefinitions
>([
  "meeting_room_page",
] as const);

export type PostHogFeatureFlagKey =
  (typeof postHogFeatureFlags.keys)[number];

export interface PostHogFeatureFlagDefinitions {
  readonly "meeting_room_page": {
    readonly value: boolean;
    readonly payload: undefined;
  };
}

export type PostHogFeatureFlagValue<
  Key extends PostHogFeatureFlagKey,
> = PostHogFeatureFlagDefinitions[Key]["value"];

export type PostHogFeatureFlagPayload<
  Key extends PostHogFeatureFlagKey,
> = PostHogFeatureFlagDefinitions[Key]["payload"];
