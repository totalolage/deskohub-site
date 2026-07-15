import { Config, Context, Effect, Layer, type Redacted } from "effect";
import { PostHogConfigError } from "./errors";

interface IPostHogConfig {
  readonly apiKey: Redacted.Redacted<string>;
  readonly host: URL;
}

const loadPostHogConfig = Config.all({
  apiKey: Config.redacted("POSTHOG_FEATURE_FLAGS_API_KEY"),
  host: Config.url("POSTHOG_HOST"),
}).pipe(
  Effect.flatMap(({ apiKey, host }) =>
    host.protocol === "https:" && !host.username && !host.password
      ? Effect.succeed({ apiKey, host: new URL(host.origin) })
      : Effect.fail(
          new PostHogConfigError({
            message:
              "POSTHOG_HOST must be an HTTPS origin without credentials.",
          })
        )
  ),
  Effect.mapError((cause) =>
    cause instanceof PostHogConfigError
      ? cause
      : new PostHogConfigError({
          message:
            "PostHog API access requires POSTHOG_FEATURE_FLAGS_API_KEY and POSTHOG_HOST.",
        })
  )
);

export class PostHogConfig extends Context.Service<
  PostHogConfig,
  IPostHogConfig
>()("@deskohub/posthog/PostHogConfig") {
  static Live = Layer.effect(this, loadPostHogConfig);
}
