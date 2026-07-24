import { resolve } from "node:path";
import { Effect, type Layer } from "effect";
import {
  createWorkspaceOtelLoggerLive,
  WorkspaceLoggerLive,
} from "../shared/backend/logging/censorship";
import {
  createPostHogLoggerProvider,
  flushPostHogLogs,
} from "../shared/backend/logging/posthog-otel";
import type { E2EEnvironment } from "./e2e-env";
import { loadEnvFile, workspaceDir } from "./runtime";

const telemetryShutdownTimeoutMs = 5_000;

export const loadLocalE2EEnvironment = () =>
  Effect.runPromise(loadEnvFile(resolve(workspaceDir, ".env.local")));

export const makeE2ETelemetryRuntime = (environment: E2EEnvironment) => {
  const provider = createPostHogLoggerProvider({
    posthogHost:
      environment.WORKSPACE_E2E_POSTHOG_HOST ??
      environment.NEXT_PUBLIC_POSTHOG_HOST,
    posthogProjectToken:
      environment.WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN ??
      environment.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    serviceName: "deskohub-workspace-e2e",
    serviceNamespace: "deskohub",
    vercelEnv: "preview",
    vercelGitCommitSha: environment.TARGET_SHA,
  });

  return {
    loggerLayer: provider
      ? createWorkspaceOtelLoggerLive(provider)
      : WorkspaceLoggerLive,
    shutdown: provider
      ? Effect.tryPromise({
          catch: (cause) => cause,
          try: async () => {
            await flushPostHogLogs({
              provider,
              timeoutMs: telemetryShutdownTimeoutMs,
            });
            await provider.shutdown();
          },
        }).pipe(
          Effect.timeout(`${telemetryShutdownTimeoutMs} millis`),
          Effect.ignoreCause
        )
      : Effect.void,
    telemetryEnabled: provider !== undefined,
  };
};

export const runE2EEffect = <A, E>(
  effect: Effect.Effect<A, E>,
  loggerLayer: Layer.Layer<never>
) => Effect.runPromiseExit(effect.pipe(Effect.provide(loggerLayer)));
