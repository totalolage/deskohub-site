import "server-only";

import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { OfficeReservationFeatureFlagService } from "./office-reservation-feature-flag.service";

export async function isOfficePageEnabled() {
  "use cache";
  cacheLife({ stale: 30, revalidate: 60, expire: 300 });

  return OfficeReservationFeatureFlagService.pipe(
    Effect.flatMap((featureFlag) => featureFlag.isEnabled),
    Effect.provide(OfficeReservationFeatureFlagService.Live),
    runWorkspaceEffect("office.page-enabled")
  );
}
