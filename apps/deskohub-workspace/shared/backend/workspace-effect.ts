import { NextEffect } from "@deskohub/next-effect";
import { Effect, Layer } from "effect";
import { after } from "next/server";
import {
  createWorkspaceOtelLoggerLive,
  WorkspaceLoggerLive,
} from "./logging/censorship";
import {
  flushPostHogLogs,
  getRegisteredPostHogLoggerProvider,
} from "./logging/posthog-otel";
import { WorkspaceTracingLive } from "./observability/workspace-tracing";
import { normalizeWorkspaceFrameworkDefects } from "./workspace-framework-failure";
import {
  isWorkspaceOperation,
  resolveWorkspaceOperation,
  type WorkspaceOperation,
} from "./workspace-operation";

type WorkspaceEffectBoundary = "action" | "route" | "run" | "task";

interface RunWorkspaceEffectOptions {
  readonly boundary?: WorkspaceEffectBoundary;
  readonly signal?: AbortSignal;
}

export const runWorkspaceEffect =
  (operation: WorkspaceOperation, options: RunWorkspaceEffectOptions = {}) =>
  <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
<<<<<<< HEAD
    getWorkspaceRuntime().run(
      resolveWorkspaceOperation(operation).pipe(
        Effect.tapError(() => Effect.logError("Workspace operation rejected")),
        Effect.flatMap(() => effect),
=======
    workspaceRuntime.run(
      (shouldScheduleTelemetryFlush(options.boundary)
        ? Effect.andThen(scheduleWorkspaceTelemetryFlush(), effect)
        : effect
      ).pipe(
>>>>>>> 71b705cb2396074a4a58813c2ab71fc15f9514df
        Effect.annotateLogs({
          boundary: options.boundary ?? "run",
          operation: isWorkspaceOperation(operation) ? operation : "operation",
        })
      ),
      { signal: options.signal }
    );

const shouldScheduleTelemetryFlush = (
  boundary: WorkspaceEffectBoundary | undefined
) => boundary === "action" || boundary === "route";

export const defineWorkspaceTask =
  <Args extends readonly unknown[], A, E>(
    operation: WorkspaceOperation,
    handler: (...args: Args) => Effect.Effect<A, E, never>
  ) =>
  (...args: Args): Promise<A> =>
    Effect.suspend(() => handler(...args)).pipe(
      normalizeWorkspaceFrameworkDefects("task"),
      Effect.ensuring(flushTelemetry),
      runWorkspaceEffect(operation, { boundary: "task" })
    );

export const scheduleWorkspaceTelemetryFlush = Effect.suspend(() =>
  getRegisteredPostHogLoggerProvider()
    ? // The scheduling error is logged and deliberately removed below.
      // @effect-diagnostics-next-line unknownInEffectCatch:off
      Effect.try({
        try: () =>
          after(() =>
            flushTelemetry.pipe(runWorkspaceEffect("telemetry.flush"))
          ),
        catch: (cause) => cause,
      }).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("PostHog log flush could not be scheduled", {
            cause,
          })
        ),
        Effect.ignore
      )
    : Effect.void
);

let workspaceRuntime:
  | {
      readonly loggerProvider: ReturnType<
        typeof getRegisteredPostHogLoggerProvider
      >;
      readonly runtime: ReturnType<typeof createWorkspaceRuntime>;
    }
  | undefined;

const getWorkspaceRuntime = () => {
  const loggerProvider = getRegisteredPostHogLoggerProvider();
  if (workspaceRuntime && workspaceRuntime.loggerProvider === loggerProvider) {
    return workspaceRuntime.runtime;
  }

  const runtime = createWorkspaceRuntime(loggerProvider);
  workspaceRuntime = { loggerProvider, runtime };
  return runtime;
};

const createWorkspaceRuntime = (
  loggerProvider: ReturnType<typeof getRegisteredPostHogLoggerProvider>
) =>
  NextEffect.make({
    layer: Layer.merge(
      loggerProvider
        ? createWorkspaceOtelLoggerLive(loggerProvider)
        : WorkspaceLoggerLive,
      WorkspaceTracingLive
    ),
  });

// The flush error is logged and deliberately removed below.
// @effect-diagnostics-next-line unknownInEffectCatch:off
const flushTelemetry = Effect.tryPromise({
  try: () => flushPostHogLogs(),
  catch: (cause) => cause,
}).pipe(
  Effect.tapError((cause) =>
    Effect.logWarning("PostHog log flush failed", { cause })
  ),
  Effect.ignoreCause
);
