import { EffectBoundary } from "@deskohub/next-effect/effect-boundary";
import { Effect } from "effect";
import { headers } from "next/headers";
import { after } from "next/server";
import { makeWorkspaceEffect } from "./effect-boundary/next";
import { createWorkspaceLoggerLive } from "./logging/censorship";
import {
  flushPostHogLogs,
  postHogLoggerProvider,
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

const workspaceEffectExecutor = EffectBoundary.makeExecutor({
  transform: (effect) =>
    Effect.provide(effect, createWorkspaceLoggerLive(postHogLoggerProvider)),
  completeTask: flushTelemetry,
});

export const WorkspaceEffect = makeWorkspaceEffect({
  executor: workspaceEffectExecutor,
  readActionHeaders,
  scheduleTelemetryFlush,
});

export {
  mapWorkspaceInternalRouteFailure,
  WorkspaceRouteFailure,
} from "./effect-boundary/route-failure";
