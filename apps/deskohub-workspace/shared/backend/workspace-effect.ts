import { NextEffect } from "@deskohub/next-effect";
import { Data, Effect, Layer } from "effect";
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

type WorkspaceEffectBoundary = "action" | "page" | "route" | "run" | "task";

interface RunWorkspaceEffectOptions {
  readonly boundary?: WorkspaceEffectBoundary;
  readonly signal?: AbortSignal;
}

class WorkspaceTelemetryError extends Data.TaggedError(
  "WorkspaceTelemetryError"
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export const runWorkspaceEffect =
  (operation: string, options: RunWorkspaceEffectOptions = {}) =>
  <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
    workspaceRuntime.run(
      effect.pipe(
        Effect.annotateLogs({
          boundary: options.boundary ?? "run",
          operation,
        })
      ),
      { signal: options.signal }
    );

export const defineWorkspaceTask =
  <Args extends readonly unknown[], A, E>(
    operation: string,
    handler: (...args: Args) => Effect.Effect<A, E, never>
  ) =>
  (...args: Args): Promise<A> =>
    Effect.suspend(() => handler(...args)).pipe(
      Effect.ensuring(flushTelemetry),
      runWorkspaceEffect(operation, { boundary: "task" })
    );

export const defineWorkspacePage = <Props, A, E>(
  operation: string,
  component: (props: Props) => Effect.Effect<A, E, never>
) =>
  workspaceRuntime.page((props: Props) =>
    component(props).pipe(
      Effect.annotateLogs({
        boundary: "page",
        operation,
      })
    )
  );

export const scheduleWorkspaceTelemetryFlush = () =>
  getRegisteredPostHogLoggerProvider()
    ? Effect.try({
        try: () =>
          after(() =>
            flushTelemetry.pipe(runWorkspaceEffect("telemetry.flush"))
          ),
        catch: (cause) =>
          new WorkspaceTelemetryError({
            cause,
            message: "PostHog log flush could not be scheduled",
          }),
      }).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("PostHog log flush could not be scheduled", {
            cause,
          })
        ),
        Effect.ignore
      )
    : Effect.void;

const registeredLoggerProvider = getRegisteredPostHogLoggerProvider();

const WorkspaceObservabilityLive = Layer.merge(
  registeredLoggerProvider
    ? createWorkspaceOtelLoggerLive(registeredLoggerProvider)
    : WorkspaceLoggerLive,
  WorkspaceTracingLive
);

const workspaceRuntime = NextEffect.make({
  layer: WorkspaceObservabilityLive,
});

const flushTelemetry = Effect.tryPromise({
  try: () => flushPostHogLogs(),
  catch: (cause) =>
    new WorkspaceTelemetryError({
      cause,
      message: "PostHog log flush failed",
    }),
}).pipe(
  Effect.timeout("5 seconds"),
  Effect.tapError((cause) =>
    Effect.logWarning("PostHog log flush failed", { cause })
  ),
  Effect.ignoreCause
);
