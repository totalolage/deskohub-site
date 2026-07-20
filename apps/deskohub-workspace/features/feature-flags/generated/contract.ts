import { definePostHogFeatureFlags } from "@deskohub/posthog/feature-flags";

/** Generated from PostHog feature flag definitions. Do not edit manually. */
export const postHogFeatureFlags = definePostHogFeatureFlags<
  PostHogFeatureFlagDefinitions
>([
  "calendar_sales",
  "customer_discounts",
  "discount_codes",
  "meeting_room_page",
  "seating_map",
] as const);

export type PostHogFeatureFlagKey =
  (typeof postHogFeatureFlags.keys)[number];

export interface PostHogFeatureFlagDefinitions {
  readonly "calendar_sales": {
    readonly value: boolean;
    readonly payload: undefined;
  };
  readonly "customer_discounts": {
    readonly value: boolean;
    readonly payload: undefined;
  };
  readonly "discount_codes": {
    readonly value: boolean;
    readonly payload: undefined;
  };
  readonly "meeting_room_page": {
    readonly value: boolean;
    readonly payload: undefined;
  };
  readonly "seating_map": {
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
