import "server-only";

import { Effect } from "effect";
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

export async function areAccountsEnabled(): Promise<boolean> {
  return AccountFeatureFlagService.pipe(
    Effect.flatMap((featureFlag) => featureFlag.isEnabled),
    Effect.provide(AccountFeatureFlagService.Live),
    runWorkspaceEffect("account.accounts-enabled")
  );
}

export async function areAccountAvatarsEnabled(): Promise<boolean> {
  return accountAvatarsEnabled.pipe(
    Effect.provide(AccountFeatureFlagService.Live),
    runWorkspaceEffect("account.avatars-enabled")
  );
}
