import { Effect, Layer } from "effect";
import {
  createIdentifiedTracingLive,
  createPostHogTracerProvider,
  type TelemetryIdentity,
} from "../shared/backend/observability/telemetry-sinks";
import type { E2EEnvironment } from "./e2e-env";
import { runUntracedE2EEffect } from "./effect-edge";
import { workspaceE2EError } from "./errors";

const telemetryShutdownTimeoutMs = 5_000;

export const makeE2ETelemetryRuntime = (environment: E2EEnvironment) => {
  const identity: TelemetryIdentity = {
    deploymentEnvironment: "preview",
    serviceName: "deskohub-workspace-e2e",
    serviceVersion: environment.TARGET_SHA,
  };
  const provider = createPostHogTracerProvider({
    ...identity,
    posthogHost: environment.WORKSPACE_E2E_POSTHOG_HOST,
    posthogProjectToken: environment.WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN,
  });

  return {
    shutdown: provider
      ? Effect.tryPromise({
          catch: (cause) =>
            workspaceE2EError("E2E trace provider shutdown failed", { cause }),
          try: async () => {
            try {
              await provider.forceFlush();
            } finally {
              await provider.shutdown();
            }
          },
        }).pipe(
          Effect.timeout(`${telemetryShutdownTimeoutMs} millis`),
          Effect.tapError(() =>
            Effect.sync(() => {
              console.warn("E2E trace export did not shut down cleanly.");
            })
          ),
          Effect.ignoreCause
        )
      : Effect.void,
    telemetryEnabled: provider !== undefined,
    tracingLayer: provider
      ? createIdentifiedTracingLive(identity, provider)
      : Layer.empty,
  };
};

type E2ETelemetryRuntime = ReturnType<typeof makeE2ETelemetryRuntime>;

export const runE2EEffect = <A, E>(
  effect: Effect.Effect<A, E>,
  telemetry: E2ETelemetryRuntime
) =>
  runUntracedE2EEffect(
    effect.pipe(
      Effect.exit,
      Effect.tap(() => telemetry.shutdown),
      Effect.provide(telemetry.tracingLayer)
    )
  );
