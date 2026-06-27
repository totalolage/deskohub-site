import { Data, Effect } from "effect";
import { env } from "@/env";

export class WorkspaceUrlConfigError extends Data.TaggedError(
  "WorkspaceUrlConfigError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const getWorkspaceRuntimeCallbackOrigin: Effect.Effect<
  URL,
  WorkspaceUrlConfigError
> = Effect.gen(function* () {
  const url =
    env.VERCEL_ENV === "production"
      ? env.VERCEL_PROJECT_PRODUCTION_URL
      : (env.WORKSPACE_CALLBACK_ORIGIN ?? env.VERCEL_URL);

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
          : `${env.VERCEL_ENV === "development" ? "http" : "https"}://${url}`
      ),
    catch: (cause) =>
      new WorkspaceUrlConfigError({
        message: "Payment checkout callback URL is not configured.",
        cause,
      }),
  });
});
