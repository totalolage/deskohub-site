import type { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Context, Effect, Layer } from "effect";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";

export interface IAccountFeatureFlagService {
  readonly isEnabled: Effect.Effect<boolean>;
  readonly isAvatarEnabled: Effect.Effect<
    boolean,
    PostHogFeatureFlagEvaluationError
  >;
}

export class AccountFeatureFlagService extends Context.Service<
  AccountFeatureFlagService,
  IAccountFeatureFlagService
>()("@deskohub-workspace/account/AccountFeatureFlagService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const featureFlags = yield* WorkspaceFeatureFlagService;

      return {
        isEnabled: featureFlags.isEnabled("accounts").pipe(
          Effect.map((value) => value === true),
          Effect.tapError(() =>
            Effect.logWarning("Account feature flag evaluation unavailable")
          ),
          Effect.orElseSucceed(() => false)
        ),
        isAvatarEnabled: featureFlags
          .isEnabled("account_avatars")
          .pipe(Effect.map((value) => value === true)),
      } satisfies IAccountFeatureFlagService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  );
}
