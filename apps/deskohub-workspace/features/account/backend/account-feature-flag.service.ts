import type { TypedPostHogFeatureFlagEvaluationSnapshot } from "@deskohub/posthog/feature-flags/node";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";
import type { PostHogFeatureFlagDefinitions } from "@/features/feature-flags/generated/contract";

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
        isEnabled: featureFlags.evaluateFlags({ flagKeys: ["accounts"] }).pipe(
          Effect.flatMap(resolveAccountFeatureFlag),
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

class AccountFeatureFlagMissingError extends Data.TaggedError(
  "AccountFeatureFlagMissingError"
)<{ readonly message: "Account feature flag is missing." }> {}

function resolveAccountFeatureFlag(
  snapshot: TypedPostHogFeatureFlagEvaluationSnapshot<PostHogFeatureFlagDefinitions>
): Effect.Effect<boolean, AccountFeatureFlagMissingError> {
  const value = snapshot.getFlag("accounts");
  return value === undefined
    ? Effect.fail(
        new AccountFeatureFlagMissingError({
          message: "Account feature flag is missing.",
        })
      )
    : Effect.succeed(value === true);
}
