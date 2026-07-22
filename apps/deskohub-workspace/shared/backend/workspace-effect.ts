import { logs } from "@opentelemetry/api-logs";
import { Effect } from "effect";
import { headers } from "next/headers";
import { after } from "next/server";
import { makeWorkspaceEffectExecutor } from "./effect-boundary/executor";
import { makeWorkspaceEffect } from "./effect-boundary/next";
import {
  flushPostHogLogs,
  schedulePostHogLogsFlush,
} from "./logging/posthog-otel";

const flushTelemetry = () =>
  Effect.tryPromise({
    try: () => flushPostHogLogs(),
    catch: (cause) => cause,
  }).pipe(
    Effect.tapError((cause) =>
      Effect.logWarning("PostHog log flush failed", { cause })
    ),
    Effect.ignore
  );

const scheduleTelemetryFlush = () =>
  Effect.try({
    try: () => schedulePostHogLogsFlush(after),
    catch: (cause) => cause,
  }).pipe(
    Effect.tapError((cause) =>
      Effect.logWarning("PostHog log flush could not be scheduled", { cause })
    ),
    Effect.ignore
  );

const readActionHeaders = () =>
  Effect.tryPromise({
    try: () => headers(),
    catch: (cause) => cause,
  }).pipe(Effect.orDie);

const workspaceEffectExecutor = makeWorkspaceEffectExecutor({
  getLoggerProvider: () => logs.getLoggerProvider(),
  flushTelemetry,
});

export const WorkspaceEffect = makeWorkspaceEffect({
  executor: workspaceEffectExecutor,
  readActionHeaders,
  scheduleTelemetryFlush,
});

export { WorkspaceRouteFailure } from "./effect-boundary/route-failure";
