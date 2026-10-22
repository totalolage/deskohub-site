import "server-only";

import { Effect, Layer } from "effect";
import { cacheLife } from "next/cache";
import { cache } from "react";
import {
  type GlobalRelease,
  globalRelease,
  WorkspaceFeatureFlagService,
} from "@/features/feature-flags/backend";
import {
  runWorkspaceEffect,
  runWorkspaceEffectOrElse,
} from "@/shared/backend/workspace-effect";
import { OfficeReservationFeatureFlagService } from "./office-reservation-feature-flag.service";

/**
 * Evaluates the office release gate at most once per server render, so the
 * page metadata, page content, and advertised prices share one evaluation.
 * Outside a render, such as in a server action, every call evaluates.
 */
export const isOfficePageEnabled = cache(async () =>
  OfficeReservationFeatureFlagService.pipe(
    Effect.flatMap((featureFlag) => featureFlag.isEnabled),
    Effect.provide(OfficeReservationFeatureFlagService.Live),
    runWorkspaceEffect("office.page-enabled")
  )
);

/** Office gate backed by the current render's shared evaluation. */
export const OfficeReservationFeatureFlagRenderLayer = Layer.succeed(
  OfficeReservationFeatureFlagService,
  { isEnabled: Effect.promise(() => isOfficePageEnabled()) }
);

/**
 * Whether office reservations are open for every visitor, read without the
 * request, so static output such as the site description can name the
 * office. A release that can't be read counts as undecided.
 *
 * `minutes` keeps it in the route's App Shell, which needs a `stale` of at
 * least five minutes, while it still revalidates every minute.
 */
export async function loadOfficeGlobalRelease(): Promise<GlobalRelease> {
  "use cache";
  cacheLife("minutes");

  return WorkspaceFeatureFlagService.pipe(
    Effect.flatMap((featureFlags) => featureFlags.constantValue("office_page")),
    Effect.map(globalRelease),
    Effect.provide(WorkspaceFeatureFlagService.Default),
    runWorkspaceEffectOrElse("office.global-release", {
      failureCode: "office.global_release.load_failed",
      orElse: (): GlobalRelease => "undecided",
    })
  );
}
