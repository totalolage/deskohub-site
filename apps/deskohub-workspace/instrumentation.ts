import "./shared/polyfills/temporal";

import { logs } from "@opentelemetry/api-logs";
import { registerOTel } from "@vercel/otel";
import {
  workspaceLoggerProvider,
  workspaceOTelRegistration,
} from "./shared/backend/observability/workspace-telemetry";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  registerOTel(workspaceOTelRegistration());

  const loggerProvider = workspaceLoggerProvider();
  if (!loggerProvider) return;

  logs.setGlobalLoggerProvider(loggerProvider);
}
