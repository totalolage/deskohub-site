import "server-only";

import { Effect } from "effect";
import { cache } from "react";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { AccountFeatureFlagService } from "../backend/account-feature-flag.service";

export const accountAvatarsEnabled = AccountFeatureFlagService.pipe(
  Effect.flatMap((featureFlag) =>
    featureFlag.isAvatarEnabled.pipe(
      Effect.tapError(() =>
        Effect.logWarning("Account avatar feature flag evaluation unavailable")
      ),
      Effect.orElseSucceed(() => false)
    )
  )
);

/** Read once per sign-in email by the send request's auth guard. */
export const isSignInCodeEnabled = async (): Promise<boolean> =>
  AccountFeatureFlagService.pipe(
    Effect.flatMap((featureFlag) => featureFlag.isSignInCodeEnabled),
    Effect.provide(AccountFeatureFlagService.Live),
    runWorkspaceEffect("account.sign-in-code-enabled")
  );

/**
 * `login_passkeys`, memoized per render: account pages read it to show
 * passkey surfaces, and the auth guard reads it once per registration
 * request.
 */
export const arePasskeysEnabled = cache(
  async (): Promise<boolean> =>
    AccountFeatureFlagService.pipe(
      Effect.flatMap((featureFlag) => featureFlag.isPasskeyEnabled),
      Effect.provide(AccountFeatureFlagService.Live),
      runWorkspaceEffect("account.passkeys-enabled")
    )
);

export async function areAccountAvatarsEnabled(): Promise<boolean> {
  return accountAvatarsEnabled.pipe(
    Effect.provide(AccountFeatureFlagService.Live),
    runWorkspaceEffect("account.avatars-enabled")
  );
}
