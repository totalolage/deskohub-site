import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { createCensoredOtelSpanExporter } from "../logging/censorship";
import { workspaceServiceResourceAttributes } from "./workspace-service";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const POSTHOG_TRACES_PATH = "/i/v1/traces";
const postHogTraceExportTimeoutMs = 2_000;

type PostHogTracerProviderOptions = {
  readonly deploymentEnvironment: string;
  readonly posthogHost?: string;
  readonly posthogProjectToken?: string;
  readonly serviceName?: string;
  readonly serviceNamespace?: string;
  readonly serviceVersion?: string;
};

export function getPostHogTracesEndpoint(posthogHost = DEFAULT_POSTHOG_HOST) {
  return new URL(POSTHOG_TRACES_PATH, posthogHost).toString();
}

export function createPostHogTracerProvider({
  deploymentEnvironment,
  posthogHost,
  posthogProjectToken,
  serviceName,
  serviceNamespace,
  serviceVersion,
}: PostHogTracerProviderOptions) {
  if (!posthogProjectToken) return undefined;

  return new BasicTracerProvider({
    resource: resourceFromAttributes({
      "deployment.environment.name": deploymentEnvironment,
      ...workspaceServiceResourceAttributes,
      ...(serviceName ? { "service.name": serviceName } : {}),
      ...(serviceNamespace ? { "service.namespace": serviceNamespace } : {}),
      ...(serviceVersion ? { "service.version": serviceVersion } : {}),
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        createCensoredOtelSpanExporter(
          new OTLPTraceExporter({
            headers: {
              Authorization: `Bearer ${posthogProjectToken}`,
            },
            timeoutMillis: postHogTraceExportTimeoutMs,
            url: getPostHogTracesEndpoint(posthogHost),
          })
        ),
        { exportTimeoutMillis: postHogTraceExportTimeoutMs }
      ),
    ],
  });
}
