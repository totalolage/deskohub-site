import "server-only";

import { Effect } from "effect";
import { connection } from "next/server";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";
import { WorkspaceFeatureFlagServiceLive } from "@/features/feature-flags/backend/workspace-feature-flag.server";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";

const meetingRoomPageFeatureFlag = Effect.gen(function* () {
  const featureFlags = yield* WorkspaceFeatureFlagService;
  return yield* featureFlags.isEnabled("meeting_room_page");
}).pipe(
  Effect.catch((error) =>
    Effect.logWarning(error.message, { cause: error.cause }).pipe(
      Effect.as(false)
    )
  ),
  Effect.provide(WorkspaceFeatureFlagServiceLive)
);

export async function isMeetingRoomPageEnabled() {
  await connection();

  return WorkspaceEffect.run(
    { operation: "meeting-room.page-enabled" },
    meetingRoomPageFeatureFlag
  );
}
