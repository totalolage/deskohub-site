import { Context, Effect, Layer } from "effect";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";

export interface IAccountFeatureFlagService {
  readonly isEnabled: Effect.Effect<boolean>;
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
      } satisfies IAccountFeatureFlagService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  );
}
