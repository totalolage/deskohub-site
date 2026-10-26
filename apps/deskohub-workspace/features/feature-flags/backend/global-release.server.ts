import "server-only";

import { Effect } from "effect";
import { cacheLife } from "next/cache";
import type { PostHogFeatureFlagKey } from "@/features/feature-flags/generated/contract";
import { runWorkspaceEffectOrElse } from "@/shared/backend/workspace-effect";
import { type GlobalRelease, globalRelease } from "./global-release";
import { WorkspaceFeatureFlagService } from "./workspace-feature-flag.service";

/**
 * Whether the flag is released for every visitor, read without the request,
 * so static output and cached shells can depend on it. A release that can't
 * be read counts as undecided.
 *
 * `minutes` keeps it in the route's App Shell, which needs a `stale` of at
 * least five minutes, while it still revalidates every minute.
 */
export async function loadGlobalRelease(
  flag: PostHogFeatureFlagKey
): Promise<GlobalRelease> {
  "use cache";
  cacheLife("minutes");

  return WorkspaceFeatureFlagService.pipe(
    Effect.flatMap((featureFlags) => featureFlags.constantValue(flag)),
    Effect.map(globalRelease),
    Effect.annotateLogs({ flag }),
    Effect.provide(WorkspaceFeatureFlagService.Default),
    runWorkspaceEffectOrElse("feature-flags.global-release", {
      failureCode: "feature_flags.global_release.load_failed",
      orElse: (): GlobalRelease => "undecided",
    })
  );
}
