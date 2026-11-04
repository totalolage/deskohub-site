import type { LoggerProvider } from "@opentelemetry/sdk-logs";
import { Effect, Layer } from "effect";
import { env } from "@/env";
import {
  createWorkspaceOtelLoggerLive,
  WorkspaceLoggerLive,
} from "../logging/censorship";
import {
  createIdentifiedTracingLive,
  createPostHogLoggerProvider,
  flushLoggerProvider,
} from "./telemetry-sinks";

export { workspaceOTelRegistration } from "./telemetry-sinks";

/**
 * The process's Workspace telemetry, kept on `globalThis` under this key.
 * Next.js evaluates this module once for `instrumentation.ts` and again for
 * the app bundles, so a module-level provider would give each instance its
 * own buffer, and a flush in one would miss records the other holds. The
 * OTel logs API can't stand in: its global provider has no `forceFlush`.
 * Tests put a provider over the SDK's in-memory exporter here before the
 * first run.
 */
export const workspaceTelemetryHandle = Symbol.for(
  "@deskohub-workspace/telemetry"
);

export interface WorkspaceTelemetryHandle {
  /** Where Workspace logs go; undefined when PostHog logging is off. */
  readonly loggerProvider: LoggerProvider | undefined;
  /** The process's log drains, shared by every module instance. */
  logDrains?: LogDrains;
}

interface LogDrains {
  /** The drain exporting now. */
  running?: Promise<void>;
  /** The drain that starts when the running one ends, shared by every caller. */
  queued?: Promise<void>;
}

type GlobalWithTelemetry = typeof globalThis & {
  [workspaceTelemetryHandle]?: WorkspaceTelemetryHandle;
};

/**
 * The process's PostHog logger provider, built from the Workspace's
 * configuration by whichever module instance asks first. Undefined without a
 * PostHog project token. Throws when PostHog is configured without its host
 * or environment; the runtime then can't build its observability.
 */
export const workspaceLoggerProvider = () => {
  const processGlobals = globalThis as GlobalWithTelemetry;
  processGlobals[workspaceTelemetryHandle] ??= {
    loggerProvider: createPostHogLoggerProvider({
      deploymentEnvironment: env.VERCEL_ENV,
      posthogHost: env.POSTHOG_INGEST_HOST,
      posthogProjectToken: env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
      serviceVersion: env.VERCEL_GIT_COMMIT_SHA,
    }),
  };
  return processGlobals[workspaceTelemetryHandle].loggerProvider;
};

/**
 * The Workspace's censoring console logger, its OTel logger when PostHog
 * logging is on, and its tracer over the global tracer provider. The process
 * logger provider is resolved when the Layer builds, not when this module
 * loads.
 */
export const WorkspaceObservabilityLive: Layer.Layer<never> = Layer.unwrap(
  Effect.sync(() => {
    const loggerProvider = workspaceLoggerProvider();
    return Layer.merge(
      loggerProvider
        ? createWorkspaceOtelLoggerLive(loggerProvider)
        : WorkspaceLoggerLive,
      createIdentifiedTracingLive({
        serviceVersion: env.VERCEL_GIT_COMMIT_SHA,
      })
    );
  })
);

/**
 * Exports what `loggerProvider` buffers when the drain starts. The SDK's
 * `forceFlush` returns at once while another is exporting, leaving records
 * logged since that one began in its buffer, behind a timer a frozen
 * invocation never fires. So a drain requested meanwhile waits for the
 * running one and then exports, and every request in that wait shares it.
 */
const drainLogs = (
  handle: WorkspaceTelemetryHandle,
  loggerProvider: Pick<LoggerProvider, "forceFlush">,
  options: Parameters<LoggerProvider["forceFlush"]>[0]
): Promise<void> => {
  handle.logDrains ??= {};
  const drains = handle.logDrains;
  if (drains.queued) return drains.queued;
  const start = () => {
    drains.queued = undefined;
    const running = loggerProvider.forceFlush(options).finally(() => {
      if (drains.running === running) drains.running = undefined;
    });
    drains.running = running;
    return running;
  };
  if (!drains.running) return start();
  drains.queued = drains.running.then(start, start);
  return drains.queued;
};

/**
 * Exports the Workspace logs the process buffers when the flush is
 * requested, within the post-response deadline. Never fails.
 */
export const flushWorkspaceLogs: Effect.Effect<void> = Effect.suspend(() => {
  const loggerProvider = workspaceLoggerProvider();
  const handle = (globalThis as GlobalWithTelemetry)[workspaceTelemetryHandle];
  return flushLoggerProvider(
    loggerProvider &&
      handle && {
        forceFlush: (options) => drainLogs(handle, loggerProvider, options),
      }
  );
});
