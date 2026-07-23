"use client";

import { createPostHogReactFeatureFlags } from "@deskohub/posthog/feature-flags/react";
import { postHogFeatureFlags } from "./generated/contract";

export const {
  applyFeatureFlagOverrides,
  useFeatureFlagEnabled,
  useFeatureFlagPayload,
  useFeatureFlagResult,
  useFeatureFlagVariantKey,
} = createPostHogReactFeatureFlags(postHogFeatureFlags);
