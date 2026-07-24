import { Effect, Layer } from "effect";
import { createTracingLive } from "../shared/backend/observability/otel-tracing";
import { createPostHogTracerProvider } from "../shared/backend/observability/posthog-tracing";
import type { E2EEnvironment } from "./e2e-env";

const e2eServiceName = "deskohub-workspace-e2e";
const e2eServiceNamespace = "deskohub";
const telemetryShutdownTimeoutMs = 5_000;

export const makeE2ETelemetryRuntime = (environment: E2EEnvironment) => {
  const provider = createPostHogTracerProvider({
    deploymentEnvironment: "preview",
    posthogHost: environment.WORKSPACE_E2E_POSTHOG_HOST,
    posthogProjectToken: environment.WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN,
    serviceName: e2eServiceName,
    serviceNamespace: e2eServiceNamespace,
    serviceVersion: environment.TARGET_SHA,
  });

  return {
    shutdown: provider
      ? Effect.tryPromise({
          catch: () => new Error("E2E trace provider shutdown failed"),
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
      ? createTracingLive({
          attributes: {
            "deployment.environment.name": "preview",
            "service.namespace": e2eServiceNamespace,
          },
          provider,
          serviceName: e2eServiceName,
          serviceVersion: environment.TARGET_SHA,
        })
      : Layer.empty,
  };
};

type E2ETelemetryRuntime = ReturnType<typeof makeE2ETelemetryRuntime>;

export const runE2EEffect = <A, E>(
  effect: Effect.Effect<A, E>,
  telemetry: E2ETelemetryRuntime
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.exit,
      Effect.tap(() => telemetry.shutdown),
      Effect.provide(telemetry.tracingLayer)
    )
  );
