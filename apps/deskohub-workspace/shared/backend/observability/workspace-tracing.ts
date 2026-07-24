import * as OtelResource from "@effect/opentelemetry/Resource";
import * as OtelTracer from "@effect/opentelemetry/Tracer";
import type { TracerProvider } from "@opentelemetry/api";
import * as Layer from "effect/Layer";
import { env } from "@/env";

export const WORKSPACE_OTEL_SERVICE_NAME = "deskohub-workspace";
export const WORKSPACE_OTEL_SERVICE_NAMESPACE = "deskohub";

const workspaceOtelResource = OtelResource.layer({
  serviceName: WORKSPACE_OTEL_SERVICE_NAME,
  ...(env.VERCEL_GIT_COMMIT_SHA
    ? { serviceVersion: env.VERCEL_GIT_COMMIT_SHA }
    : {}),
  attributes: {
    "service.namespace": WORKSPACE_OTEL_SERVICE_NAMESPACE,
  },
});

export const createWorkspaceTracingLive = (provider?: TracerProvider) => {
  const providerLive = provider
    ? Layer.succeed(OtelTracer.OtelTracerProvider, provider)
    : OtelTracer.layerGlobalProvider;

  return OtelTracer.layer.pipe(
    Layer.provide(Layer.merge(providerLive, workspaceOtelResource))
  );
};

export const WorkspaceTracingLive = createWorkspaceTracingLive();
