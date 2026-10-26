import "server-only";

import { Effect } from "effect";
import { cache } from "react";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { MeetingRoomPageFeatureFlagService } from "./meeting-room-page-feature-flag.service";

/**
 * Evaluates the meeting-room page release gate at most once per server
 * render, so the page metadata, page content, header and landing hero share
 * one evaluation. Outside a render every call evaluates.
 */
export const isMeetingRoomPageEnabled = cache(async () =>
  MeetingRoomPageFeatureFlagService.pipe(
    Effect.flatMap((featureFlag) => featureFlag.isEnabled),
    Effect.provide(MeetingRoomPageFeatureFlagService.Live),
    runWorkspaceEffect("meeting-room.page-enabled")
  )
);
