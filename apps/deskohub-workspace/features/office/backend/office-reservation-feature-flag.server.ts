import "server-only";

import { Effect, Layer } from "effect";
import { connection } from "next/server";
import { WorkspaceFeatureFlagServiceLive } from "@/features/feature-flags/backend/workspace-feature-flag.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { OfficeReservationFeatureFlagService } from "./office-reservation-feature-flag.service";

export const OfficeReservationFeatureFlagServiceLive =
  OfficeReservationFeatureFlagService.Live.pipe(
    Layer.provide(WorkspaceFeatureFlagServiceLive)
  );

export async function isOfficePageEnabled() {
  await connection();

  return OfficeReservationFeatureFlagService.pipe(
    Effect.flatMap((featureFlag) => featureFlag.isEnabled),
    Effect.provide(OfficeReservationFeatureFlagServiceLive),
    runWorkspaceEffect("office.page-enabled")
  );
}
