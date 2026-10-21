import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";

/**
 * Whether the site tools register for every visitor: `on` or `off` when
 * `webmcp_site_tools` is the same for everyone, `undecided` when PostHog
 * decides it per visitor or the value can't be read without a request.
 */
export type SiteToolsRelease = "on" | "undecided" | "off";

export interface ISiteToolsFeatureFlagService {
  /**
   * `webmcp_site_tools`: whether the public agent tools register as browser
   * site tools. Only `true` enables them; a flag that cannot be evaluated,
   * including one PostHog omits, counts as off.
   */
  readonly isEnabled: Effect.Effect<boolean>;
  /** The release for every visitor, read without the request. */
  readonly release: Effect.Effect<SiteToolsRelease>;
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

      const release = featureFlags.constantValue("webmcp_site_tools").pipe(
        Effect.map(
          Option.match({
            onNone: (): SiteToolsRelease => "undecided",
            onSome: (enabled): SiteToolsRelease => (enabled ? "on" : "off"),
          })
        )
      );

      return { isEnabled, release } satisfies ISiteToolsFeatureFlagService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  );
}
