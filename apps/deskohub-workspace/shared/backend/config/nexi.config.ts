import {
  getNexiRequestWorstCaseDuration,
  NexiRuntimeConfig,
  NexiService,
} from "@deskohub/nexi";
import { Duration, Layer } from "effect";
import { env } from "@/env";
import {
  byStage,
  type DeploymentEnvironment,
} from "@/shared/deployment/deployment-stage";

/**
 * The Nexi sandbox can take several seconds to create a hosted payment page,
 * and a timeout there leaves the payment attempt ambiguous, so non-production
 * deployments wait much longer than production.
 */
export const getNexiRequestTimeoutMilliseconds = (
  deploymentEnvironment: DeploymentEnvironment
) =>
  Duration.toMillis(
    byStage(deploymentEnvironment, {
      production: Duration.seconds(5),
      otherwise: Duration.seconds(30),
    })
  );

/** The per-request Nexi timeout of this deployment. */
export const nexiRequestTimeout = Duration.millis(
  getNexiRequestTimeoutMilliseconds(env.VERCEL_ENV)
);

/**
 * The longest a retried Nexi request of this deployment can take when every
 * attempt times out.
 */
export const nexiRequestWorstCaseDuration =
  getNexiRequestWorstCaseDuration(nexiRequestTimeout);

export const makeWorkspaceNexiLayer = (
  deploymentEnvironment: DeploymentEnvironment
) =>
  NexiService.Live.pipe(
    Layer.provide(
      Layer.succeed(NexiRuntimeConfig, {
        baseUrl: env.NEXI_API_ORIGIN,
        apiKey: env.NEXI_API_KEY,
        apiTimeout: getNexiRequestTimeoutMilliseconds(deploymentEnvironment),
      })
    )
  );

export const WorkspaceNexiLayer = makeWorkspaceNexiLayer(env.VERCEL_ENV);
