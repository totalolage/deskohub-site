import "server-only";

import { Effect } from "effect";
import { connection } from "next/server";
import { FeatureFlagService } from "@/features/feature-flags/backend";
import { PostHogRuntimeConfigLive } from "@/shared/backend/config/posthog.config";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

const publicSiteDistinctId = "deskohub-workspace:public-site";

const getMeetingRoomPageFeatureFlag = Effect.fn(
  "getMeetingRoomPageFeatureFlag"
)(() =>
  FeatureFlagService.pipe(
    Effect.flatMap((featureFlags) =>
      featureFlags.isEnabled({
        distinctId: publicSiteDistinctId,
        key: "meeting_room_page",
      })
    ),
    Effect.catch((error) =>
      Effect.logWarning(error.message, { cause: error.cause }).pipe(
        Effect.as(false)
      )
    )
  )
);

export async function isMeetingRoomPageEnabled() {
  await connection();

  return getMeetingRoomPageFeatureFlag().pipe(
    Effect.provide(FeatureFlagService.Live),
    Effect.provide(PostHogRuntimeConfigLive),
    runWorkspaceEffect
  );
}
