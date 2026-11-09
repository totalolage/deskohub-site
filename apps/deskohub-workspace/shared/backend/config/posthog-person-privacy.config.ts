import {
  getPostHogPersonDeletionWorstCase,
  type PostHogPersonsConfigInput,
} from "@deskohub/posthog/persons";
import { Context, Duration, Layer, Option, Redacted } from "effect";
import { env } from "@/env";
import {
  byStage,
  type DeploymentEnvironment,
} from "@/shared/deployment/deployment-stage";

/**
 * The per-attempt timeout of a PostHog person deletion. Like the other
 * provider timeouts, it is tight in production and generous elsewhere; the
 * deletion runs after the response, so no visitor waits for it either way.
 */
export const getPostHogPersonDeletionAttemptTimeout = (
  deploymentEnvironment: DeploymentEnvironment
) =>
  byStage(deploymentEnvironment, {
    production: Duration.seconds(5),
    otherwise: Duration.seconds(30),
  });

/**
 * The longest a person deletion, ledger reads and retries included, may run.
 * Vercel's 300-second function limit also bounds work scheduled after the
 * response; the rest is room for the request before it, the cold start, and
 * the telemetry flush. The deletion is cut off at this budget.
 */
export const postHogPersonDeletionBudget = Duration.seconds(240);

/** The longest a person deletion of this deployment can take. */
export const getPostHogPersonDeletionWorstCaseDuration = (
  deploymentEnvironment: DeploymentEnvironment
) =>
  getPostHogPersonDeletionWorstCase(
    getPostHogPersonDeletionAttemptTimeout(deploymentEnvironment)
  );

export interface PostHogPersonPrivacyConfigObj {
  /**
   * The PostHog person deletion settings; none when the person privacy key
   * or the project is not configured, so no person profile can be deleted.
   */
  readonly persons: Option.Option<PostHogPersonsConfigInput>;
}

type PostHogPersonPrivacyEnvironment = Pick<
  typeof env,
  | "POSTHOG_API_HOST"
  | "POSTHOG_PERSON_PRIVACY_API_KEY"
  | "POSTHOG_PROJECT_ID"
  | "VERCEL_ENV"
>;

export const getPostHogPersonPrivacyConfig = (
  environment: PostHogPersonPrivacyEnvironment
): PostHogPersonPrivacyConfigObj => ({
  persons: Option.all({
    apiKey: Option.fromUndefinedOr(environment.POSTHOG_PERSON_PRIVACY_API_KEY),
    projectId: Option.fromUndefinedOr(environment.POSTHOG_PROJECT_ID),
  }).pipe(
    Option.map(({ apiKey, projectId }) => ({
      apiKey: Redacted.make(apiKey),
      host: new URL(environment.POSTHOG_API_HOST),
      projectId,
      attemptTimeout: getPostHogPersonDeletionAttemptTimeout(
        environment.VERCEL_ENV
      ),
    }))
  ),
});

export class PostHogPersonPrivacyConfig extends Context.Service<
  PostHogPersonPrivacyConfig,
  PostHogPersonPrivacyConfigObj
>()("@deskohub-workspace/analytics/PostHogPersonPrivacyConfig") {
  static Default = Layer.sync(this, () => getPostHogPersonPrivacyConfig(env));
}
