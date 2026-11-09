import { Data, Effect, Result } from "effect";
import { env } from "@/env";

export class WorkspaceUrlConfigError extends Data.TaggedError(
  "WorkspaceUrlConfigError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface WorkspaceCallbackEnvironment {
  readonly deploymentEnvironment: "development" | "preview" | "production";
  readonly deploymentUrl: string | undefined;
  readonly productionUrl: string | undefined;
}

export const getWorkspaceCallbackOrigin = (
  environment: WorkspaceCallbackEnvironment
): Effect.Effect<URL, WorkspaceUrlConfigError> =>
  Effect.suspend(() =>
    Effect.fromResult(resolveWorkspaceCallbackOrigin(environment))
  );

export const getWorkspaceRuntimeCallbackOrigin: Effect.Effect<
  URL,
  WorkspaceUrlConfigError
> = Effect.suspend(() =>
  Effect.fromResult(resolveWorkspaceRuntimeCallbackOrigin())
);

/**
 * Resolves the callback origin of the running deployment synchronously, for
 * callers such as the proxy that must not start an Effect runtime.
 */
export const resolveWorkspaceRuntimeCallbackOrigin = () =>
  resolveWorkspaceCallbackOrigin({
    deploymentEnvironment: env.VERCEL_ENV,
    deploymentUrl: env.VERCEL_URL,
    productionUrl: env.VERCEL_PROJECT_PRODUCTION_URL,
  });

const resolveWorkspaceCallbackOrigin = ({
  deploymentEnvironment,
  deploymentUrl,
  productionUrl,
}: WorkspaceCallbackEnvironment): Result.Result<
  URL,
  WorkspaceUrlConfigError
> => {
  const url =
    deploymentEnvironment === "production" ? productionUrl : deploymentUrl;

  if (!url) {
    return Result.fail(
      new WorkspaceUrlConfigError({
        message: "Payment checkout callback URL is not configured.",
      })
    );
  }

  return Result.try({
    try: () =>
      new URL(
        url.includes("://")
          ? url
          : `${deploymentEnvironment === "development" ? "http" : "https"}://${url}`
      ),
    catch: (cause) =>
      new WorkspaceUrlConfigError({
        message: "Payment checkout callback URL is not configured.",
        cause,
      }),
  });
};
