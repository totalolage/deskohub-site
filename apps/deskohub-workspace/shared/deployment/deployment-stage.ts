import type { env } from "@/env";

export type DeploymentEnvironment = (typeof env)["VERCEL_ENV"];

/**
 * Selects the production value on a production deployment and the
 * `otherwise` value on every other deployment, including one whose stage is
 * missing.
 */
export const byStage = <A>(
  deploymentEnvironment: DeploymentEnvironment,
  choices: { readonly production: A; readonly otherwise: A }
): A =>
  deploymentEnvironment === "production"
    ? choices.production
    : choices.otherwise;
