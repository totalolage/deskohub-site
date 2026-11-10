import "server-only";

import { env } from "@/env";
import {
  byStage,
  type DeploymentEnvironment,
} from "@/shared/deployment/deployment-stage";

/**
 * Whether this deployment may ask PostHog to evaluate feature flags over the
 * network. Under `disabled`, a flag that is neither constant nor overridden
 * stays closed and nothing calls PostHog's `/flags` endpoint.
 */
export type RemoteEvaluationPolicy = "allowed" | "disabled";

/**
 * Only the production deployment evaluates remotely. Previews, E2E runs,
 * local development and tests share production's PostHog project and flag
 * request quota, so they read flags from overrides and constant definitions
 * only. A missing stage counts as non-production.
 */
export const remoteEvaluationPolicyFor = (
  deploymentEnvironment: DeploymentEnvironment | undefined
): RemoteEvaluationPolicy =>
  deploymentEnvironment === undefined
    ? "disabled"
    : byStage(deploymentEnvironment, {
        production: "allowed",
        otherwise: "disabled",
      });

/** The policy for this deployment's validated `VERCEL_ENV`. */
export const readRemoteEvaluationPolicy = (): RemoteEvaluationPolicy =>
  remoteEvaluationPolicyFor(env.VERCEL_ENV);
