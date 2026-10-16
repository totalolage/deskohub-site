import "server-only";

import { Context, Layer, Option, Redacted } from "effect";
import { env } from "@/env";
import type { DeploymentEnvironment } from "@/shared/backend/config/deployment-request-timeout";

interface IDotyposCustomerSourceAccess {
  /** The token PostHog must present, or none while the source is disabled. */
  readonly token: Option.Option<Redacted.Redacted<string>>;
}

export class DotyposCustomerSourceAccess extends Context.Service<
  DotyposCustomerSourceAccess,
  IDotyposCustomerSourceAccess
>()("DotyposCustomerSourceAccess") {
  static Default = Layer.sync(this, () => ({
    token: resolveDotyposCustomerSourceToken({
      deploymentEnvironment: env.VERCEL_ENV,
      configuredToken: env.ANALYTICS_WAREHOUSE_SOURCE_TOKEN,
    }),
  }));
}

/**
 * Real customer data leaves only production. Preview and development
 * deployments run unreviewed branches, so they keep the source disabled even
 * when a token reaches their environment by mistake.
 */
export const resolveDotyposCustomerSourceToken = (input: {
  readonly deploymentEnvironment: DeploymentEnvironment;
  readonly configuredToken: string | undefined;
}): Option.Option<Redacted.Redacted<string>> =>
  input.deploymentEnvironment === "production" && input.configuredToken
    ? Option.some(Redacted.make(input.configuredToken))
    : Option.none();
