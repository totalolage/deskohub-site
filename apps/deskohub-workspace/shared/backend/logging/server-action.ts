import { Effect } from "effect";
import { headers } from "next/headers";
import { after } from "next/server";
import { runWorkspaceEffect } from "./censorship";
import {
  getPostHogLogAnnotationsFromRequestHeadersWithDiagnostics,
  logUnexpectedConsentCookieReasons,
} from "./posthog-log-annotations";
import { schedulePostHogLogsFlush } from "./posthog-otel";

export async function runWorkspaceServerActionEffect<A, E>(
  effect: Effect.Effect<A, E, never>
) {
  schedulePostHogLogsFlush(after);

  const requestHeaders = await headers();
  const { annotations, unexpectedConsentCookieReasons } =
    getPostHogLogAnnotationsFromRequestHeadersWithDiagnostics(requestHeaders);

  return runWorkspaceEffect(
    Effect.gen(function* () {
      yield* logUnexpectedConsentCookieReasons(unexpectedConsentCookieReasons);
      return yield* effect;
    }).pipe(Effect.annotateLogs(annotations))
  );
}
