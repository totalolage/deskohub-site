import "server-only";

import { makePostHogNodeFeatureFlagService } from "@deskohub/posthog/feature-flags/node";
import { postHogRuntimeConfig } from "@/shared/backend/config/posthog.config";
import { postHogFeatureFlags } from "../generated/contract";

export const nodeFeatureFlags = makePostHogNodeFeatureFlagService(
  postHogFeatureFlags,
  {
    clientOptions: {
      featureFlagsRequestTimeoutMs: 2_000,
      host: postHogRuntimeConfig.host,
    },
    defaultEvaluationOptions: { disableGeoip: true },
    projectToken: postHogRuntimeConfig.projectToken,
  }
);
