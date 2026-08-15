import "server-only";

import { Effect } from "effect";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { OfficeReservationFeatureFlagService } from "./office-reservation-feature-flag.service";

export async function isOfficePageEnabled() {
  return OfficeReservationFeatureFlagService.pipe(
    Effect.flatMap((featureFlag) => featureFlag.isEnabled),
    Effect.provide(OfficeReservationFeatureFlagService.Live),
    runWorkspaceEffect("office.page-enabled")
  );
}
