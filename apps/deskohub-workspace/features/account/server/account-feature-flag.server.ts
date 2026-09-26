import "server-only";

import { Effect } from "effect";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { AccountFeatureFlagService } from "../backend/account-feature-flag.service";

export async function areAccountsEnabled(): Promise<boolean> {
  return AccountFeatureFlagService.pipe(
    Effect.flatMap((featureFlag) => featureFlag.isEnabled),
    Effect.provide(AccountFeatureFlagService.Live),
    runWorkspaceEffect("account.accounts-enabled")
  );
}
