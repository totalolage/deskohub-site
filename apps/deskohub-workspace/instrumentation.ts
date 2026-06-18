import "./shared/polyfills/temporal";

import { logs } from "@opentelemetry/api-logs";
import { postHogLoggerProvider } from "./shared/backend/logging/posthog-otel";

export { flushPostHogLogs } from "./shared/backend/logging/posthog-otel";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !postHogLoggerProvider) return;

  logs.setGlobalLoggerProvider(postHogLoggerProvider);
}
