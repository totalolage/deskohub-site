import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const POSTHOG_LOGS_PATH = "/i/v1/logs";

type PostHogLoggerProviderOptions = {
  readonly posthogHost?: string;
  readonly posthogProjectToken?: string;
  readonly vercelEnv?: string;
  readonly vercelGitCommitSha?: string;
};

type PostHogLogsFlushScheduler = (task: () => Promise<void>) => void;

export function getPostHogLogsEndpoint(posthogHost = DEFAULT_POSTHOG_HOST) {
  return new URL(POSTHOG_LOGS_PATH, posthogHost).toString();
}

export function createPostHogLoggerProvider({
  posthogHost,
  posthogProjectToken,
  vercelEnv,
  vercelGitCommitSha,
}: PostHogLoggerProviderOptions) {
  if (!posthogProjectToken) return undefined;
  if (!vercelEnv) {
    throw new Error("VERCEL_ENV is required when PostHog logging is enabled");
  }

  return new LoggerProvider({
    resource: resourceFromAttributes({
      "deployment.environment.name": vercelEnv,
      "service.name": "deskohub-workspace",
      "service.namespace": "deskohub",
      ...(vercelGitCommitSha ? { "service.version": vercelGitCommitSha } : {}),
    }),
    processors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          headers: {
            Authorization: `Bearer ${posthogProjectToken}`,
            "Content-Type": "application/json",
          },
          url: getPostHogLogsEndpoint(posthogHost),
        })
      ),
    ],
  });
}

export const postHogLoggerProvider = createPostHogLoggerProvider({
  posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  posthogProjectToken: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  vercelEnv: process.env.VERCEL_ENV,
  vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA,
});

export async function flushPostHogLogs() {
  await postHogLoggerProvider?.forceFlush();
}

export function schedulePostHogLogsFlush(schedule: PostHogLogsFlushScheduler) {
  if (postHogLoggerProvider) {
    schedule(() => postHogLoggerProvider.forceFlush());
  }
}
