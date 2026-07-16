import "server-only";

import { Effect } from "effect";
import { connection } from "next/server";
import {
  getCurrentPostHogFeatureFlagSubject,
  nodeFeatureFlags,
} from "@/features/feature-flags/backend";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

const meetingRoomPageFeatureFlag = Effect.gen(function* () {
  const subject = yield* getCurrentPostHogFeatureFlagSubject();
  return yield* nodeFeatureFlags.isEnabled({
    key: "meeting_room_page",
    subject,
  });
}).pipe(
  Effect.catch((error) =>
    Effect.logWarning(error.message, { cause: error.cause }).pipe(
      Effect.as(false)
    )
  )
);

export async function isMeetingRoomPageEnabled() {
  await connection();

  return meetingRoomPageFeatureFlag.pipe(runWorkspaceEffect);
}
