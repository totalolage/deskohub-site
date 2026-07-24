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
import { loadEnvFile, workspaceDir } from "./runtime";

const telemetryShutdownTimeoutMs = 5_000;

export const loadLocalE2EEnvironment = () =>
  Effect.runPromise(loadEnvFile(resolve(workspaceDir, ".env.local")));

export const makeE2ETelemetryRuntime = (
  environment: NodeJS.ProcessEnv = process.env
) => {
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
    shutdown: async () => {
      if (!provider) return;
      await flushPostHogLogs({
        provider,
        timeoutMs: telemetryShutdownTimeoutMs,
      });
      await settleWithin(provider.shutdown(), telemetryShutdownTimeoutMs);
    },
    telemetryEnabled: provider !== undefined,
  };
};

export const runE2EEffect = <A, E>(
  effect: Effect.Effect<A, E>,
  loggerLayer: Layer.Layer<never>
) => Effect.runPromiseExit(effect.pipe(Effect.provide(loggerLayer)));

const settleWithin = async (task: Promise<void>, timeoutMs: number) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    task.catch(() => undefined),
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
};
