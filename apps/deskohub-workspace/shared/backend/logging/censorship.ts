import { logs } from "@opentelemetry/api-logs";
import { Effect } from "effect";
import { after } from "next/server";
import { createWorkspaceEffectRunner } from "./censorship-core";
import {
  getPostHogLogAnnotationsFromRequestHeadersWithDiagnostics,
  logUnexpectedConsentCookieReasons,
} from "./posthog-log-annotations";
import { schedulePostHogLogsFlush } from "./posthog-otel";

export * from "./censorship-core";

const workspaceEffectRunner = createWorkspaceEffectRunner(
  logs.getLoggerProvider()
);

export const runWorkspaceEffect = workspaceEffectRunner.run;
export const runWorkspaceEffectWithLogAnnotations =
  workspaceEffectRunner.runWithLogAnnotations;

export const runWorkspaceRequestEffect = <A, E>(
  request: Request,
  effect: Effect.Effect<A, E, never>,
  options?: { readonly signal?: AbortSignal }
) => {
  schedulePostHogLogsFlush(after);
  const { annotations, unexpectedConsentCookieReasons } =
    getPostHogLogAnnotationsFromRequestHeadersWithDiagnostics(request.headers);

  return runWorkspaceEffectWithLogAnnotations(
    Effect.gen(function* () {
      yield* logUnexpectedConsentCookieReasons(unexpectedConsentCookieReasons);
      return yield* effect;
    }),
    annotations,
    options
  );
};
