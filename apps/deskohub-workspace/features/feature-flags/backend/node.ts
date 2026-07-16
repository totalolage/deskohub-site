import "server-only";

import { makePostHogNodeFeatureFlagService } from "@deskohub/posthog/feature-flags/node";
import { postHogRuntimeConfig } from "@/shared/backend/config/posthog.config";
import { postHogFeatureFlags } from "../generated/contract";

export const nodeFeatureFlags = makePostHogNodeFeatureFlagService(
  postHogFeatureFlags,
  {
    disableGeoip: true,
    featureFlagsRequestTimeoutMs: 2_000,
    host: postHogRuntimeConfig.host,
    projectToken: postHogRuntimeConfig.projectToken,
  }
);
