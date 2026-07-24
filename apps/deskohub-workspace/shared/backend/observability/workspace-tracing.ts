import * as OtelResource from "@effect/opentelemetry/Resource";
import * as OtelTracer from "@effect/opentelemetry/Tracer";
import { type TracerProvider, trace } from "@opentelemetry/api";
import * as Layer from "effect/Layer";
import { env } from "@/env";
import { createCensoredTracerProvider } from "./censored-tracer-provider";
import {
  WORKSPACE_SERVICE_NAME,
  WORKSPACE_SERVICE_NAMESPACE,
} from "./workspace-service";

const workspaceOtelResource = OtelResource.layer({
  serviceName: WORKSPACE_SERVICE_NAME,
  ...(env.VERCEL_GIT_COMMIT_SHA
    ? { serviceVersion: env.VERCEL_GIT_COMMIT_SHA }
    : {}),
  attributes: {
    "service.namespace": WORKSPACE_SERVICE_NAMESPACE,
  },
});

export const createWorkspaceTracingLive = (provider?: TracerProvider) => {
  const providerLive = Layer.sync(OtelTracer.OtelTracerProvider, () =>
    createCensoredTracerProvider(provider ?? trace.getTracerProvider())
  );

  return OtelTracer.layer.pipe(
    Layer.provide(Layer.merge(providerLive, workspaceOtelResource))
  );
};

export const WorkspaceTracingLive = createWorkspaceTracingLive();
