import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { workspaceServiceResourceAttributes } from "../observability/workspace-service";

const POSTHOG_LOGS_PATH = "/i/v1/logs";

type PostHogLoggerProviderOptions = {
  readonly posthogHost?: string;
  readonly posthogProjectToken?: string;
  readonly vercelEnv?: string;
  readonly vercelGitCommitSha?: string;
};

type PostHogLogsFlushProvider = Pick<LoggerProvider, "forceFlush">;

type PostHogLogsFlushOptions = {
  readonly provider: PostHogLogsFlushProvider | undefined;
  readonly timeoutMs?: number;
};

const postHogLogsFlushTimeoutMs = 2_000;

export function getPostHogLogsEndpoint(posthogHost: string) {
  return new URL(POSTHOG_LOGS_PATH, posthogHost).toString();
}

export function createPostHogLoggerProvider({
  posthogHost,
  posthogProjectToken,
  vercelEnv,
  vercelGitCommitSha,
}: PostHogLoggerProviderOptions) {
  if (!posthogProjectToken) return undefined;
  if (!posthogHost) {
    throw new Error(
      "POSTHOG_INGEST_HOST is required when PostHog logging is enabled"
    );
  }
  if (!vercelEnv) {
    throw new Error("VERCEL_ENV is required when PostHog logging is enabled");
  }

  return new LoggerProvider({
    resource: resourceFromAttributes({
      "deployment.environment.name": vercelEnv,
      ...workspaceServiceResourceAttributes,
      "service.version": vercelGitCommitSha,
    }),
    processors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          headers: {
            Authorization: `Bearer ${posthogProjectToken}`,
            "Content-Type": "application/json",
          },
          timeoutMillis: postHogLogsFlushTimeoutMs,
          url: getPostHogLogsEndpoint(posthogHost),
        }),
        { exportTimeoutMillis: postHogLogsFlushTimeoutMs }
      ),
    ],
    forceFlushTimeoutMillis: postHogLogsFlushTimeoutMs,
  });
}

export async function flushPostHogLogs(options: PostHogLogsFlushOptions) {
  const provider = options.provider;
  if (!provider) return;

  const timeoutMs = options.timeoutMs ?? postHogLogsFlushTimeoutMs;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    provider.forceFlush().then(
      () => "completed" as const,
      () => "failed" as const
    ),
    new Promise<"timed_out">((resolve) => {
      timeout = setTimeout(() => resolve("timed_out"), timeoutMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);

  if (result === "failed") {
    console.warn("PostHog log flush failed.");
  } else if (result === "timed_out") {
    console.warn("PostHog log flush exceeded its post-response deadline.");
  }
}
