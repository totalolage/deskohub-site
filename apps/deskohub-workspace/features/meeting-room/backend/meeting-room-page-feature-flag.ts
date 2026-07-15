import "server-only";

import { Effect } from "effect";
import { connection } from "next/server";
import { PostHog } from "posthog-node";
import { env } from "@/env";
import { isPostHogFeatureFlagEnabled } from "@/shared/backend/feature-flags/posthog-feature-flag";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

const publicSiteDistinctId = "deskohub-workspace:public-site";

const getMeetingRoomPageFeatureFlag = Effect.fn(
  "getMeetingRoomPageFeatureFlag"
)(function* () {
  const projectToken = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

  if (!projectToken) return false;

  return yield* isPostHogFeatureFlagEnabled({
    client: new PostHog(projectToken, {
      featureFlagsRequestTimeoutMs: 2_000,
      host: env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    }),
    distinctId: publicSiteDistinctId,
    key: "meeting_room_page",
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning(error.message, { cause: error.cause }).pipe(
        Effect.as(false)
      )
    )
  );
});

export async function isMeetingRoomPageEnabled() {
  await connection();

  return getMeetingRoomPageFeatureFlag().pipe(runWorkspaceEffect);
}
