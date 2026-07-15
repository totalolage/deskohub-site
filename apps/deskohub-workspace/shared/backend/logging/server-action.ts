import { Effect } from "effect";
import { headers } from "next/headers";
import { after } from "next/server";
import { runWorkspace } from "./censorship";
import {
  getPostHogLogAnnotationsFromRequestHeadersWithDiagnostics,
  logUnexpectedConsentCookieReasons,
} from "./posthog-log-annotations";
import { schedulePostHogLogsFlush } from "./posthog-otel";

export async function runWorkspaceServerAction<A, E>(
  effect: Effect.Effect<A, E, never>
) {
  schedulePostHogLogsFlush(after);

  const requestHeaders = await headers();
  const { annotations, unexpectedConsentCookieReasons } =
    getPostHogLogAnnotationsFromRequestHeadersWithDiagnostics(requestHeaders);

  return runWorkspace(
    Effect.gen(function* () {
      yield* logUnexpectedConsentCookieReasons(unexpectedConsentCookieReasons);
      return yield* effect;
    }).pipe(Effect.annotateLogs(annotations))
  );
}
