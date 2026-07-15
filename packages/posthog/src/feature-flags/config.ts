import { Config, Context, Effect, Layer, Redacted } from "effect";
import { PostHogFeatureFlagError } from "./errors";

export interface PostHogFeatureFlagConfig {
  readonly apiKey: Redacted.Redacted<string>;
  readonly host: URL;
  readonly projectId: string;
}

export class PostHogFeatureFlagRuntimeConfig extends Context.Service<
  PostHogFeatureFlagRuntimeConfig,
  PostHogFeatureFlagConfig
>()("@deskohub/posthog/PostHogFeatureFlagRuntimeConfig") {
  static Live = Layer.effect(
    this,
    Config.all({
      apiKey: Config.redacted("POSTHOG_FEATURE_FLAGS_API_KEY"),
      host: Config.url("POSTHOG_HOST").pipe(
        Config.withDefault(new URL("https://us.posthog.com"))
      ),
      projectId: Config.nonEmptyString("POSTHOG_PROJECT_ID"),
    }).pipe(
      Effect.flatMap(({ apiKey, host, projectId }) => {
        const normalizedProjectId = projectId.trim();
        if (!normalizedProjectId || !Redacted.value(apiKey).trim()) {
          return Effect.fail(
            new PostHogFeatureFlagError({
              message:
                "PostHog feature flag sync requires a non-blank API key and project ID.",
            })
          );
        }
        if (host.protocol !== "https:" && host.protocol !== "http:") {
          return Effect.fail(
            new PostHogFeatureFlagError({
              message: "POSTHOG_HOST must use HTTP or HTTPS.",
            })
          );
        }

        return Effect.succeed({
          apiKey,
          host,
          projectId: normalizedProjectId,
        });
      })
    )
  );
}

export const makePostHogFeatureFlagConfigLayer = (
  config: PostHogFeatureFlagConfig
) => Layer.succeed(PostHogFeatureFlagRuntimeConfig, config);
