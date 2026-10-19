import "server-only";

import { Effect } from "effect";
import { cache } from "react";
import { runWorkspaceEffectOrElse } from "@/shared/backend/workspace-effect";
import { SiteToolsFeatureFlagService } from "./site-tools-feature-flag.service";

/**
 * Memoized per request: layouts and pages of one render share it. Any
 * failure, including a defect or a runtime that cannot start, counts as off.
 */
export const areSiteToolsEnabled = cache(
  async (): Promise<boolean> =>
    SiteToolsFeatureFlagService.pipe(
      Effect.flatMap((featureFlag) => featureFlag.isEnabled),
      Effect.provide(SiteToolsFeatureFlagService.Live),
      runWorkspaceEffectOrElse("agent-tools.site-tools-enabled", {
        failureCode: "site_tools_feature_flag_unavailable",
        orElse: () => false,
      })
    )
);
