import { Context, Effect, Layer } from "effect";
import {
  type GlobalRelease,
  globalRelease,
  WorkspaceFeatureFlagService,
} from "@/features/feature-flags/backend";

export interface ISiteToolsFeatureFlagService {
  /**
   * `webmcp_site_tools`: whether the public agent tools register as browser
   * site tools. Only `true` enables them; a flag that cannot be evaluated,
   * including one PostHog omits, counts as off.
   */
  readonly isEnabled: Effect.Effect<boolean>;
  /** Whether the site tools register for every visitor, read without the request. */
  readonly release: Effect.Effect<GlobalRelease>;
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

      const release = featureFlags
        .constantValue("webmcp_site_tools")
        .pipe(Effect.map(globalRelease));

      return { isEnabled, release } satisfies ISiteToolsFeatureFlagService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  );
}
