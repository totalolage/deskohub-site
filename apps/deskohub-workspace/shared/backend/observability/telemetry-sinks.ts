import { CloudinarySignatureRedactor } from "@deskohub/cloudinary/telemetry";
import * as OtelResource from "@effect/opentelemetry/Resource";
import * as OtelTracer from "@effect/opentelemetry/Tracer";
import type { TracerProvider } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
} from "@opentelemetry/sdk-logs";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Data, Effect, Layer } from "effect";
import { createCensoredOtelSpanExporter } from "../logging/censorship";

/**
 * Builders for the Workspace's telemetry sinks: its service identity, the
 * span redaction stack, the PostHog OTLP log and trace exports, the Effect
 * tracer, and the bounded log flush. They read no environment, so the E2E
 * runner, which has no Workspace configuration, builds its trace export here
 * too. The Workspace process binds them to its configuration in
 * `workspace-telemetry.ts`.
 */

const WORKSPACE_SERVICE_NAME = "deskohub-workspace";
const WORKSPACE_SERVICE_NAMESPACE = "deskohub";

/** Who emits the telemetry. The service defaults to the Workspace. */
export interface TelemetryIdentity {
  readonly deploymentEnvironment?: string;
  readonly serviceName?: string;
  readonly serviceVersion?: string;
}

const identityResource = ({
  deploymentEnvironment,
  serviceName = WORKSPACE_SERVICE_NAME,
  serviceVersion,
}: TelemetryIdentity) =>
  resourceFromAttributes({
    "deployment.environment.name": deploymentEnvironment,
    "service.name": serviceName,
    "service.namespace": WORKSPACE_SERVICE_NAMESPACE,
    "service.version": serviceVersion,
  });

/**
 * `registerOTel` options for the Workspace: its identity, with the span
 * redactors ahead of the automatic exporting processors.
 */
export const workspaceOTelRegistration = () => ({
  serviceName: WORKSPACE_SERVICE_NAME,
  attributes: { "service.namespace": WORKSPACE_SERVICE_NAMESPACE },
  spanProcessors: [...createWorkspaceSpanRedactors(), "auto" as const],
});

/**
 * Span processors that scrub credentials, such as signed Cloudinary URL
 * signatures, from span names and attributes. Every tracer provider built
 * here lists them ahead of its exporting span processor, whichever
 * instrumentation records the span.
 */
const createWorkspaceSpanRedactors = (): SpanProcessor[] => [
  new CloudinarySignatureRedactor(),
];

const postHogEndpoint = (posthogHost: string, path: string) =>
  new URL(path, posthogHost).toString();

const postHogExportTimeoutMs = 2_000;

interface PostHogSinkOptions extends TelemetryIdentity {
  readonly posthogHost?: string;
  readonly posthogProjectToken?: string;
}

/** The provider that batches log records into `exporter` under `identity`. */
const createWorkspaceLoggerProvider = (
  exporter: LogRecordExporter,
  identity: TelemetryIdentity
) =>
  new LoggerProvider({
    resource: identityResource(identity),
    processors: [
      new BatchLogRecordProcessor({
        exporter,
        exportTimeoutMillis: postHogExportTimeoutMs,
      }),
    ],
  });

/**
 * The provider that exports log records to PostHog, or undefined without a
 * project token.
 */
export function createPostHogLoggerProvider({
  posthogHost,
  posthogProjectToken,
  ...identity
}: PostHogSinkOptions) {
  if (!posthogProjectToken) return undefined;
  if (!posthogHost) {
    throw new Error(
      "POSTHOG_INGEST_HOST is required when PostHog logging is enabled"
    );
  }
  if (!identity.deploymentEnvironment) {
    throw new Error("VERCEL_ENV is required when PostHog logging is enabled");
  }

  return createWorkspaceLoggerProvider(
    new OTLPLogExporter({
      headers: {
        Authorization: `Bearer ${posthogProjectToken}`,
        "Content-Type": "application/json",
      },
      timeoutMillis: postHogExportTimeoutMs,
      url: postHogEndpoint(posthogHost, "/i/v1/logs"),
    }),
    identity
  );
}

/**
 * The provider that redacts and censors spans before it batches them into
 * `exporter` under `identity`. Tests pass the SDK's in-memory exporter.
 */
export const createWorkspaceTracerProvider = (
  exporter: SpanExporter,
  identity: TelemetryIdentity
) =>
  new BasicTracerProvider({
    resource: identityResource(identity),
    spanProcessors: [
      ...createWorkspaceSpanRedactors(),
      new BatchSpanProcessor(createCensoredOtelSpanExporter(exporter), {
        exportTimeoutMillis: postHogExportTimeoutMs,
      }),
    ],
  });

/**
 * The provider that exports redacted, censored spans to PostHog, or
 * undefined without a project token.
 */
export function createPostHogTracerProvider({
  posthogHost,
  posthogProjectToken,
  ...identity
}: PostHogSinkOptions) {
  if (!posthogProjectToken) return undefined;
  if (!posthogHost) {
    throw new Error(
      "POSTHOG_INGEST_HOST is required when PostHog tracing is enabled"
    );
  }

  return createWorkspaceTracerProvider(
    new OTLPTraceExporter({
      headers: { Authorization: `Bearer ${posthogProjectToken}` },
      timeoutMillis: postHogExportTimeoutMs,
      url: postHogEndpoint(posthogHost, "/i/v1/traces"),
    }),
    identity
  );
}

interface TracingLiveOptions {
  readonly attributes?: Record<string, boolean | number | string>;
  readonly provider?: TracerProvider;
  readonly serviceName: string;
  readonly serviceVersion?: string;
}

/**
 * The Effect tracer over `provider`, or over the global tracer provider that
 * `registerOTel` installs when there is none.
 */
export const createTracingLive = ({
  attributes,
  provider,
  serviceName,
  serviceVersion,
}: TracingLiveOptions) => {
  const providerLive = provider
    ? Layer.succeed(OtelTracer.OtelTracerProvider, provider)
    : OtelTracer.layerGlobalProvider;
  const resourceLive = OtelResource.layer({
    attributes,
    serviceName,
    serviceVersion,
  });

  return OtelTracer.layer.pipe(
    Layer.provide(Layer.merge(providerLive, resourceLive))
  );
};

/** The Effect tracer for `identity`, over `provider` or the global one. */
export const createIdentifiedTracingLive = (
  { deploymentEnvironment, serviceName, serviceVersion }: TelemetryIdentity,
  provider?: TracerProvider
) =>
  createTracingLive({
    attributes: {
      ...(deploymentEnvironment && {
        "deployment.environment.name": deploymentEnvironment,
      }),
      "service.namespace": WORKSPACE_SERVICE_NAMESPACE,
    },
    provider,
    serviceName: serviceName ?? WORKSPACE_SERVICE_NAME,
    serviceVersion,
  });

class LogFlushError extends Data.TaggedError("LogFlushError")<{
  readonly cause: unknown;
}> {}

/**
 * Exports the log records `provider` still buffers within the post-response
 * deadline. Never fails: a rejected or overdue flush is logged as a warning.
 */
export const flushLoggerProvider = (
  provider: Pick<LoggerProvider, "forceFlush"> | undefined,
  timeoutMs = postHogExportTimeoutMs
): Effect.Effect<void> =>
  provider
    ? Effect.tryPromise({
        try: () => provider.forceFlush({ timeoutMillis: timeoutMs }),
        catch: (cause) => new LogFlushError({ cause }),
      }).pipe(
        Effect.timeout(timeoutMs),
        Effect.catchTags({
          LogFlushError: ({ cause }) =>
            Effect.logWarning("PostHog log flush failed.", { cause }),
          TimeoutError: () =>
            Effect.logWarning(
              "PostHog log flush exceeded its post-response deadline."
            ),
        })
      )
    : Effect.void;
