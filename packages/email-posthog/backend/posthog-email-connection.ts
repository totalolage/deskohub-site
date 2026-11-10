import { ProviderRetryPolicy } from "@deskohub/provider-request";
import { Config, Duration, Effect, Option, type Redacted } from "effect";

/** How the package reaches one PostHog project's email API. */
export interface PostHogEmailConnection {
  /** A project secret API key (`phs_…`) with the `transactional_email` scopes. */
  readonly secretKey: Redacted.Redacted<string>;
  /**
   * The PostHog app host, such as `https://eu.posthog.com`. A PostHog Cloud
   * ingestion host (`https://eu.i.posthog.com`) is mapped to its app host, so
   * the secret key never reaches an ingestion endpoint.
   */
  readonly host: string;
  /** Bounds one HTTP attempt; defaults to {@link deploymentPostHogEmailRequestTimeout}. */
  readonly timeout?: Duration.Input;
}

const usAppHost = "https://us.posthog.com";
const euAppHost = "https://eu.posthog.com";

/** PostHog Cloud hosts and the app host that serves their email API. */
const cloudAppHosts: Readonly<Record<string, string>> = {
  "https://us.i.posthog.com": usAppHost,
  "https://us.posthog.com": usAppHost,
  "https://app.posthog.com": usAppHost,
  "https://eu.i.posthog.com": euAppHost,
  "https://eu.posthog.com": euAppHost,
};

/** The app host that serves the email API of `host`. */
export const postHogAppHost = (host: string) => {
  const origin = host.trim().replace(/\/+$/, "");
  return cloudAppHosts[origin] ?? origin;
};

/**
 * Production fails a slow PostHog request fast. Preview, development, CI, and
 * E2E deployments wait longer, like the Resend provider.
 */
const postHogEmailRequestTimeouts = {
  production: Duration.seconds(5),
  nonProduction: Duration.seconds(30),
} as const;

/** The per-attempt timeout of the deployment `VERCEL_ENV` names. */
export const deploymentPostHogEmailRequestTimeout = Effect.gen(function* () {
  const environment = yield* Config.option(Config.string("VERCEL_ENV"));
  return Option.contains(environment, "production")
    ? postHogEmailRequestTimeouts.production
    : postHogEmailRequestTimeouts.nonProduction;
}).pipe(Effect.orDie);

/** The connection's per-attempt timeout. */
export const postHogEmailAttemptTimeout = (
  connection: PostHogEmailConnection
) =>
  connection.timeout === undefined
    ? deploymentPostHogEmailRequestTimeout
    : Effect.succeed(Duration.fromInputUnsafe(connection.timeout));

/**
 * A send retries a throttled, in-flight, unavailable, or unanswered request
 * under its idempotency key twice, with a jittered exponential backoff from
 * 1 second, honouring a `Retry-After` of up to 30 seconds.
 */
export const postHogEmailRetryPolicy = ProviderRetryPolicy.make({
  label: "PostHog email",
  baseDelay: "1 second",
  maxRetries: 2,
});

/** The longest `Retry-After` a send waits out; a longer one ends its retries. */
export const postHogEmailMaxRetryAfter = Duration.seconds(30);
