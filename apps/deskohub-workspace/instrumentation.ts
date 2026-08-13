import "./shared/polyfills/temporal";

import { logs } from "@opentelemetry/api-logs";
import { registerOTel } from "@vercel/otel";
import { env } from "./env";
import { createPostHogLoggerProvider } from "./shared/backend/logging/posthog-otel";
import {
  WORKSPACE_SERVICE_NAME,
  WORKSPACE_SERVICE_NAMESPACE,
} from "./shared/backend/observability/workspace-service";

export const postHogLoggerProvider = createPostHogLoggerProvider({
  posthogHost: env.NEXT_PUBLIC_POSTHOG_HOST,
  posthogProjectToken: env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  vercelEnv: env.VERCEL_ENV,
  vercelGitCommitSha: env.VERCEL_GIT_COMMIT_SHA,
});

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  registerOTel({
    serviceName: WORKSPACE_SERVICE_NAME,
    attributes: {
      "service.namespace": WORKSPACE_SERVICE_NAMESPACE,
    },
  });

  if (!postHogLoggerProvider) return;

  logs.setGlobalLoggerProvider(postHogLoggerProvider);
}
