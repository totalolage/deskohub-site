import "../../shared/polyfills/temporal";

import { test as base } from "@playwright/test";
import type { HttpClient } from "effect/unstable/http";
import type { WorkspaceE2EHostedPaymentPermitService } from "../coordination/hosted-payment-permit.service";
import type { WorkspaceE2EProviderVerificationPermitService } from "../coordination/provider-verification-permit.service";
import { makeWorkspaceE2EEnvironment } from "../e2e-env";
import type { E2EDatabase } from "../integrations/database.service";
import { type E2EEffectRunner, withE2ERuntime } from "../runtime-fixture";
import type { WorkspaceE2ECleanupService } from "../services/cleanup";
import { makeWorkspaceE2ECaseRuntimeLive } from "../services/runner";
import type { E2ERunContext, E2ETelemetryService } from "../services/telemetry";
import { readWorkspaceE2ERunContext } from "./run-context";

type WorkspaceE2ERuntimeServices =
  | E2EDatabase
  | E2ETelemetryService
  | HttpClient.HttpClient
  | WorkspaceE2ECleanupService
  | WorkspaceE2EHostedPaymentPermitService
  | WorkspaceE2EProviderVerificationPermitService;

type WorkspaceE2EEffectRunner = E2EEffectRunner<WorkspaceE2ERuntimeServices>;

// Runs `use` against one traced case runtime, then disposes it and flushes
// its traces.
export const withWorkspaceE2ERuntime = <A>(
  environment: ReturnType<typeof makeWorkspaceE2EEnvironment>,
  runContext: E2ERunContext,
  use: (runEffect: WorkspaceE2EEffectRunner) => Promise<A>
): Promise<A> =>
  withE2ERuntime(
    {
      layer: makeWorkspaceE2ECaseRuntimeLive(environment, runContext),
      tracing: environment,
    },
    use
  );

type WorkspaceE2ERuntimeFixtures = {
  readonly environment: ReturnType<typeof makeWorkspaceE2EEnvironment>;
  readonly runContext: Awaited<ReturnType<typeof readWorkspaceE2ERunContext>>;
  readonly runEffect: WorkspaceE2EEffectRunner;
};

export const runtimeTest = base.extend<
  Record<never, never>,
  WorkspaceE2ERuntimeFixtures
>({
  environment: [
    async ({ browserName: _browserName }, use) =>
      use(makeWorkspaceE2EEnvironment()),
    { scope: "worker" },
  ],
  runContext: [
    async ({ browserName: _browserName }, use) =>
      use(await readWorkspaceE2ERunContext()),
    { scope: "worker" },
  ],
  runEffect: [
    async ({ environment, runContext }, use) =>
      withWorkspaceE2ERuntime(environment, runContext, use),
    { scope: "worker" },
  ],
});
