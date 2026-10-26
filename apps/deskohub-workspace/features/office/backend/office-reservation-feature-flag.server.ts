import "server-only";

import { Effect, Layer } from "effect";
import { cache } from "react";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
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
