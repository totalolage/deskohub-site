import { Context, Effect, Layer } from "effect";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";

export interface ISiteToolsFeatureFlagService {
  /**
   * `webmcp_site_tools`: whether the public agent tools register as browser
   * site tools. Only `true` enables them; a flag that cannot be evaluated,
   * including one PostHog omits, counts as off.
   */
  readonly isEnabled: Effect.Effect<boolean>;
}

export class SiteToolsFeatureFlagService extends Context.Service<
  SiteToolsFeatureFlagService,
  ISiteToolsFeatureFlagService
>()("@deskohub-workspace/agent-tools/SiteToolsFeatureFlagService") {
  /**
   * Evaluates the flag at most once per build of this layer, so one run sees
   * one decision. Never put this in a process-wide runtime layer.
   */
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const featureFlags = yield* WorkspaceFeatureFlagService;
      const isEnabled = yield* Effect.cached(
        featureFlags.isEnabled("webmcp_site_tools").pipe(
          Effect.tapError((error) =>
            Effect.logWarning(
              "Site tools feature flag evaluation unavailable",
              {
                cause: error.cause,
              }
            )
          ),
          Effect.orElseSucceed(() => false)
        )
      );

      return { isEnabled } satisfies ISiteToolsFeatureFlagService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  );
}
