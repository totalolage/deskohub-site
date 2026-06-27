import { Effect } from "effect";
import { cookies } from "next/headers";
import { after } from "next/server";
import { runWorkspaceEffect } from "./censorship";
import { getPostHogLogAnnotationsFromRequestHeaders } from "./posthog-log-annotations";
import { schedulePostHogLogsFlush } from "./posthog-otel";

export async function runWorkspaceServerActionEffect<A, E>(
  effect: Effect.Effect<A, E, never>
) {
  schedulePostHogLogsFlush(after);

  const cookieStore = await cookies();

  return runWorkspaceEffect(
    effect.pipe(
      Effect.annotateLogs(
        getPostHogLogAnnotationsFromRequestHeaders(
          new Headers({
            cookie: cookieStore
              .getAll()
              .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
              .join("; "),
          })
        )
      )
    )
  );
}
