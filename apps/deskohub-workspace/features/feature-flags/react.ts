"use client";

import { createPostHogReactFeatureFlags } from "@deskohub/analytics-posthog/feature-flags/react";
import { postHogFeatureFlags } from "./generated/contract";

export const { applyFeatureFlagOverrides, useFeatureFlagEnabled } =
  createPostHogReactFeatureFlags(postHogFeatureFlags);
