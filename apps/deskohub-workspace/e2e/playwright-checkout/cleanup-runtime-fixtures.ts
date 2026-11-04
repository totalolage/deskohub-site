import { test as base } from "@playwright/test";
import { Layer } from "effect";
import { WorkspaceE2EAccountResourceService } from "../account/resources.service";
import { getDatasourceConfig } from "../config";
import { makeWorkspaceE2EEnvironment } from "../e2e-env";
import type { E2EDatabase } from "../integrations/database.service";
import { addDatabaseUrlRedactions } from "../runtime";
import { type E2EEffectRunner, withE2ERuntime } from "../runtime-fixture";
import {
  type E2ERunContext,
  E2ERunContextService,
  E2ETelemetryService,
} from "../services/telemetry";
import { readWorkspaceE2ERunContext } from "./run-context";

type CleanupRuntimeFixtures = {
  readonly environment: ReturnType<typeof makeWorkspaceE2EEnvironment>;
  readonly runContext: E2ERunContext;
  readonly runEffect: E2EEffectRunner<
    E2EDatabase | E2ETelemetryService | WorkspaceE2EAccountResourceService
  >;
};

// Cleanup must finish without provider-permit connectivity, so its runtime
// holds only the E2E database, account resources, and telemetry.
const makeCleanupRuntimeLive = (
  environment: ReturnType<typeof makeWorkspaceE2EEnvironment>,
  runContext: E2ERunContext
) => {
  const datasourceConfig = getDatasourceConfig(environment);
  addDatabaseUrlRedactions(datasourceConfig.databaseUrlUnpooled);
  return Layer.mergeAll(
    WorkspaceE2EAccountResourceService.layerWithDatabase(datasourceConfig),
    E2ETelemetryService.Default.pipe(
      Layer.provideMerge(E2ERunContextService.layerValue(runContext))
    )
  );
};

export const cleanupTest = base.extend<
  Record<never, never>,
  CleanupRuntimeFixtures
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
      withE2ERuntime(
        {
          layer: makeCleanupRuntimeLive(environment, runContext),
          tracing: environment,
        },
        use
      ),
    { scope: "worker" },
  ],
});
