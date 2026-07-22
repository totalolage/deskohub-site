import "server-only";

import { Effect } from "effect";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";

export const isMeetingRoomPageEnabled = Effect.gen(function* () {
  const featureFlags = yield* WorkspaceFeatureFlagService;
  return yield* featureFlags.isEnabled("meeting_room_page");
}).pipe(
  Effect.catch((error) =>
    Effect.logWarning(error.message, { cause: error.cause }).pipe(
      Effect.as(false)
    )
  )
);
