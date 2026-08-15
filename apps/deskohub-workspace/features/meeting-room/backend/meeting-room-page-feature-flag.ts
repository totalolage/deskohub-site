import "server-only";

import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

const meetingRoomPageFeatureFlag = Effect.gen(function* () {
  const featureFlags = yield* WorkspaceFeatureFlagService;
  return yield* featureFlags.isEnabled("meeting_room_page");
}).pipe(
  Effect.catch((error) =>
    Effect.logWarning(error.message, { cause: error.cause }).pipe(
      Effect.as(false)
    )
  ),
  Effect.provide(WorkspaceFeatureFlagService.Default)
);

export async function isMeetingRoomPageEnabled() {
  "use cache";
  cacheLife({ stale: 30, revalidate: 60, expire: 300 });

  return meetingRoomPageFeatureFlag.pipe(
    runWorkspaceEffect("meeting-room.page-enabled")
  );
}
