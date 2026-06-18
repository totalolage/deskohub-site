import { Effect } from "effect";
import { cookies } from "next/headers";
import { after } from "next/server";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";
import { runWorkspaceEffect } from "./censorship";
import { getPostHogLogAnnotationsFromCookieValues } from "./posthog-log-annotations";
import { schedulePostHogLogsFlush } from "./posthog-otel";

export async function runWorkspaceServerActionEffect<A, E>(
  effect: Effect.Effect<A, E, never>
) {
  schedulePostHogLogsFlush(after);

  const cookieStore = await cookies();

  return runWorkspaceEffect(
    effect.pipe(
      Effect.annotateLogs(
        getPostHogLogAnnotationsFromCookieValues({
          distinctId: cookieStore.get(POSTHOG_DISTINCT_ID_COOKIE)?.value,
          sessionId: cookieStore.get(POSTHOG_SESSION_ID_COOKIE)?.value,
        })
      )
    )
  );
}
