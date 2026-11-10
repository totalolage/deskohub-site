import type { PostHogEmailConnection } from "@deskohub/email-posthog";
import { Config, Effect, Option, Redacted } from "effect";

/**
 * The PostHog project that sends campaign email and reports its status: the
 * `POSTHOG_API_HOST` project, reached with `POSTHOG_EMAIL_SECRET_KEY`. None
 * without the key, as before PostHog email is set up and outside production;
 * campaign email then goes through Resend alone and nothing polls PostHog.
 */
export const configuredPostHogEmailConnection: Effect.Effect<
  Option.Option<PostHogEmailConnection>,
  Config.ConfigError
> = Effect.gen(function* () {
  const secretKey = (yield* Config.option(
    Config.string("POSTHOG_EMAIL_SECRET_KEY")
  )).pipe(
    Option.map((key) => key.trim()),
    Option.filter((key) => key !== "")
  );
  if (Option.isNone(secretKey)) return Option.none();
  const host = yield* Config.option(Config.string("POSTHOG_API_HOST"));
  if (Option.isNone(host)) {
    // The validated env requires the host; without it, keep mail flowing
    // through Resend rather than failing every send.
    yield* Effect.logWarning(
      "PostHog email is off: POSTHOG_EMAIL_SECRET_KEY is set without POSTHOG_API_HOST"
    );
    return Option.none();
  }
  return Option.some({
    secretKey: Redacted.make(secretKey.value),
    host: host.value,
  });
});
