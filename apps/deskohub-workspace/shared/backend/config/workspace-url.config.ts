import { Data, Effect } from "effect";
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

export const getWorkspaceCallbackOrigin = ({
  deploymentEnvironment,
  deploymentUrl,
  productionUrl,
}: WorkspaceCallbackEnvironment): Effect.Effect<URL, WorkspaceUrlConfigError> =>
  Effect.gen(function* () {
    const url =
      deploymentEnvironment === "production" ? productionUrl : deploymentUrl;

    if (!url) {
      return yield* new WorkspaceUrlConfigError({
        message: "Payment checkout callback URL is not configured.",
      });
    }

    return yield* Effect.try({
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
  });

export const getWorkspaceRuntimeCallbackOrigin = getWorkspaceCallbackOrigin({
  deploymentEnvironment: env.VERCEL_ENV,
  deploymentUrl: env.VERCEL_URL,
  productionUrl: env.VERCEL_PROJECT_PRODUCTION_URL,
});
