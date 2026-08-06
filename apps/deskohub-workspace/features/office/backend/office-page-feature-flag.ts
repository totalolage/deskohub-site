import "server-only";

import { Effect } from "effect";
import { connection } from "next/server";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";
import { WorkspaceFeatureFlagServiceLive } from "@/features/feature-flags/backend/workspace-feature-flag.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

const officePageFeatureFlag = Effect.gen(function* () {
  const featureFlags = yield* WorkspaceFeatureFlagService;
  return yield* featureFlags.isEnabled("office_page");
}).pipe(
  Effect.catch((error) =>
    Effect.logWarning(error.message, { cause: error.cause }).pipe(
      Effect.as(false)
    )
  ),
  Effect.provide(WorkspaceFeatureFlagServiceLive)
);

export async function isOfficePageEnabled() {
  await connection();

  return officePageFeatureFlag.pipe(runWorkspaceEffect("office.page-enabled"));
}
