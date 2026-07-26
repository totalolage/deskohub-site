import type { TracerProvider } from "@opentelemetry/api";
import { env } from "@/env";
import { createCensoredTracerProvider } from "./censored-tracer-provider";
import { createTracingLive } from "./otel-tracing";
import {
  WORKSPACE_SERVICE_NAME,
  WORKSPACE_SERVICE_NAMESPACE,
} from "./workspace-service";

export const createWorkspaceTracingLive = (provider?: TracerProvider) =>
  createTracingLive({
    attributes: {
      "service.namespace": WORKSPACE_SERVICE_NAMESPACE,
    },
    ...(provider ? { provider } : {}),
    transformProvider: createCensoredTracerProvider,
    serviceName: WORKSPACE_SERVICE_NAME,
    ...(env.VERCEL_GIT_COMMIT_SHA
      ? { serviceVersion: env.VERCEL_GIT_COMMIT_SHA }
      : {}),
  });

export const WorkspaceTracingLive = createWorkspaceTracingLive();
