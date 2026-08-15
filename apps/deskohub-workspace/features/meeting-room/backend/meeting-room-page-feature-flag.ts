import "server-only";

import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { connection } from "next/server";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";
import { areWorkspaceFeatureFlagsGlobal } from "@/features/feature-flags/backend/feature-flag-evaluation-mode.server";
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
  if (await areWorkspaceFeatureFlagsGlobal(["meeting_room_page"])) {
    return isGlobalMeetingRoomPageEnabled();
  }

  await connection();
  return meetingRoomPageFeatureFlag.pipe(
    Effect.provide(WorkspaceFeatureFlagService.Default),
    runWorkspaceEffect("meeting-room.page-enabled")
  );
}

async function isGlobalMeetingRoomPageEnabled() {
  "use cache";
  cacheLife({ stale: 30, revalidate: 60, expire: 300 });

  return meetingRoomPageFeatureFlag.pipe(
    Effect.provide(WorkspaceFeatureFlagService.GlobalRelease),
    runWorkspaceEffect("meeting-room.page-enabled")
  );
}
