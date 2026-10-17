import type { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Context, Effect, Layer } from "effect";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";

export interface IAccountFeatureFlagService {
  /** `login_email_code`: sign-in emails carry a code. Fails closed. */
  readonly isSignInCodeEnabled: Effect.Effect<boolean>;
  /**
   * `login_passkeys`: passkey surfaces show and new passkeys can be added.
   * Passkey sign-in doesn't depend on it. Fails closed.
   */
  readonly isPasskeyEnabled: Effect.Effect<boolean>;
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
        isSignInCodeEnabled: featureFlags.isEnabled("login_email_code").pipe(
          Effect.map((value) => value === true),
          Effect.tapError(() =>
            Effect.logWarning(
              "Sign-in code feature flag evaluation unavailable"
            )
          ),
          Effect.orElseSucceed(() => false)
        ),
        isPasskeyEnabled: featureFlags.isEnabled("login_passkeys").pipe(
          Effect.map((value) => value === true),
          Effect.tapError(() =>
            Effect.logWarning("Passkey feature flag evaluation unavailable")
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
