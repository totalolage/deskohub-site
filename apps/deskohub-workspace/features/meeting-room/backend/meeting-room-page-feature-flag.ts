import "server-only";

import { Effect } from "effect";
import { connection } from "next/server";
import {
  getCurrentPostHogFeatureFlagSubject,
  nodeFeatureFlags,
} from "@/features/feature-flags/backend";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

const getMeetingRoomPageFeatureFlag = Effect.fn(
  "getMeetingRoomPageFeatureFlag"
)(() =>
  Effect.Do.pipe(
    Effect.bind("subject", getCurrentPostHogFeatureFlagSubject),
    Effect.bind("enabled", ({ subject }) =>
      nodeFeatureFlags.isEnabled({
        key: "meeting_room_page",
        subject,
      })
    ),
    Effect.map(({ enabled }) => enabled),
    Effect.catch((error) =>
      Effect.logWarning(error.message, { cause: error.cause }).pipe(
        Effect.as(false)
      )
    )
  )
);

export async function isMeetingRoomPageEnabled() {
  await connection();

  return getMeetingRoomPageFeatureFlag().pipe(runWorkspaceEffect);
}
