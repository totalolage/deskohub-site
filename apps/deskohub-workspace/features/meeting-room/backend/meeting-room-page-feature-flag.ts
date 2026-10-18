import "server-only";

import { Effect } from "effect";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { MeetingRoomPageFeatureFlagService } from "./meeting-room-page-feature-flag.service";

export async function isMeetingRoomPageEnabled() {
  return MeetingRoomPageFeatureFlagService.pipe(
    Effect.flatMap((featureFlag) => featureFlag.isEnabled),
    Effect.provide(MeetingRoomPageFeatureFlagService.Live),
    runWorkspaceEffect("meeting-room.page-enabled")
  );
}
