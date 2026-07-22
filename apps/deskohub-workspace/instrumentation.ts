import "./shared/polyfills/temporal";

import { logs } from "@opentelemetry/api-logs";
import { env } from "./env";
import {
  createPostHogLoggerProvider,
  registerPostHogLoggerProvider,
} from "./shared/backend/logging/posthog-otel";

export { flushPostHogLogs } from "./shared/backend/logging/posthog-otel";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const postHogLoggerProvider = createPostHogLoggerProvider({
    posthogHost: env.NEXT_PUBLIC_POSTHOG_HOST,
    posthogProjectToken: env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    vercelEnv: env.VERCEL_ENV,
    vercelGitCommitSha: env.VERCEL_GIT_COMMIT_SHA,
  });
  if (!postHogLoggerProvider) return;

  registerPostHogLoggerProvider(postHogLoggerProvider);
  logs.setGlobalLoggerProvider(postHogLoggerProvider);
}
