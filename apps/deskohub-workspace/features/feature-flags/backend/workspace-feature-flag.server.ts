import "server-only";

import { Effect } from "effect";
import { nodeFeatureFlags } from "./node";
import { getCurrentPostHogFeatureFlagSubject } from "./subject";
import { WorkspaceFeatureFlagService } from "./workspace-feature-flag.service";

export const WorkspaceFeatureFlagServiceLive = WorkspaceFeatureFlagService.from(
  {
    evaluateFlags: Effect.fn("WorkspaceFeatureFlagService.evaluateFlags")(
      (options) =>
        getCurrentPostHogFeatureFlagSubject().pipe(
          Effect.flatMap((subject) =>
            nodeFeatureFlags.evaluateFlags({ options, subject })
          )
        )
    ),
    isEnabled: Effect.fn("WorkspaceFeatureFlagService.isEnabled")((key) =>
      getCurrentPostHogFeatureFlagSubject().pipe(
        Effect.flatMap((subject) =>
          nodeFeatureFlags.isEnabled({ key, subject })
        )
      )
    ),
  }
);
