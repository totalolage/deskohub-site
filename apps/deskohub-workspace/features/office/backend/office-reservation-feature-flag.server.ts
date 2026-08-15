import "server-only";

import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { connection } from "next/server";
import { areWorkspaceFeatureFlagsGlobal } from "@/features/feature-flags/backend/feature-flag-evaluation-mode.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { OfficeReservationFeatureFlagService } from "./office-reservation-feature-flag.service";

export async function isOfficePageEnabled() {
  if (await areWorkspaceFeatureFlagsGlobal(["office_page"])) {
    return isGlobalOfficePageEnabled();
  }

  await connection();
  return OfficeReservationFeatureFlagService.pipe(
    Effect.flatMap((featureFlag) => featureFlag.isEnabled),
    Effect.provide(OfficeReservationFeatureFlagService.Live),
    runWorkspaceEffect("office.page-enabled")
  );
}

async function isGlobalOfficePageEnabled() {
  "use cache";
  cacheLife("globalRelease");

  return OfficeReservationFeatureFlagService.pipe(
    Effect.flatMap((featureFlag) => featureFlag.isEnabled),
    Effect.provide(OfficeReservationFeatureFlagService.GlobalRelease),
    runWorkspaceEffect("office.page-enabled")
  );
}
