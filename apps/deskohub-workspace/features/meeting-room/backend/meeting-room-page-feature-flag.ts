import "server-only";

import { Effect } from "effect";
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
  )
);

export async function isMeetingRoomPageEnabled() {
  return meetingRoomPageFeatureFlag.pipe(
    Effect.provide(WorkspaceFeatureFlagService.Default),
    runWorkspaceEffect("meeting-room.page-enabled")
  );
}
