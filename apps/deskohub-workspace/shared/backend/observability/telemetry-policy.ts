import { type LogLevel, Schema } from "effect";

/**
 * Which deployments export Workspace logs to PostHog. "production-only", the
 * default, keeps preview and development logs on the console: E2E runs against
 * previews used to exhaust the PostHog Logs quota. "always" opts a deployment
 * in, for example through a branch-scoped Vercel Preview variable while
 * diagnosing that preview.
 */
export const postHogLogsExportSchema = Schema.Literals([
  "production-only",
  "always",
]);

export type PostHogLogsExport = typeof postHogLogsExportSchema.Type;

/** Whether a deployment in `deploymentEnvironment` exports its logs. */
export const isPostHogLogsExportEnabled = ({
  deploymentEnvironment,
  logsExport = "production-only",
}: {
  readonly deploymentEnvironment?: string | undefined;
  readonly logsExport?: PostHogLogsExport | undefined;
}) => logsExport === "always" || deploymentEnvironment === "production";

/** Effect's log level names, as `WORKSPACE_LOG_LEVEL` accepts them. */
export const workspaceLogLevelSchema = Schema.Literals([
  "All",
  "Fatal",
  "Error",
  "Warn",
  "Info",
  "Debug",
  "Trace",
  "None",
] as const satisfies readonly LogLevel.LogLevel[]);

/**
 * The least severe level Workspace runs log: `logLevel` when set, else Info in
 * production and Debug everywhere else.
 */
export const workspaceMinimumLogLevel = ({
  deploymentEnvironment,
  logLevel,
}: {
  readonly deploymentEnvironment?: string | undefined;
  readonly logLevel?: LogLevel.LogLevel | undefined;
}): LogLevel.LogLevel =>
  logLevel ?? (deploymentEnvironment === "production" ? "Info" : "Debug");
