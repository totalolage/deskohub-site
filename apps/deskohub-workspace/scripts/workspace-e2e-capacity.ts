import "../shared/polyfills/temporal";

import { Cause, Effect, Exit } from "effect";
import {
  getWorkspaceE2ECapacityFailures,
  getWorkspaceE2ECapacityInterval,
  makeWorkspaceE2ECapacityReport,
} from "../e2e/capacity";
import { getDatasourceConfig } from "../e2e/config";
import { makeE2EEnvironment } from "../e2e/e2e-env";
import { formatWorkspaceE2EFailure } from "../e2e/errors";
import { loadDotyposCapacityInventory } from "../e2e/integrations/dotypos";
import { runStandaloneWorkspaceEffect } from "../shared/backend/standalone-workspace-effect";

const environment = makeE2EEnvironment();
const datasourceConfig = getDatasourceConfig(environment);
const { endDate: to, startDate: from } = getWorkspaceE2ECapacityInterval();
const inventoryExit = await loadDotyposCapacityInventory(datasourceConfig, {
  endDate: to,
  startDate: from,
}).pipe(Effect.exit, runStandaloneWorkspaceEffect("workspace-e2e.capacity"));

if (Exit.isFailure(inventoryExit)) {
  process.stderr.write(
    `${formatWorkspaceE2EFailure(Cause.squash(inventoryExit.cause))}\n`
  );
  process.exit(1);
}

const report = makeWorkspaceE2ECapacityReport({
  from,
  reservations: inventoryExit.value.reservations,
  tables: inventoryExit.value.tables,
  to,
});

process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`);

if (!report.meetsRequiredCapacity) {
  const diagnostic = JSON.stringify({
    failures: getWorkspaceE2ECapacityFailures(report),
    provisionedRunCapacity: report.provisionedRunCapacity,
    supportedConcurrentRuns: report.supportedConcurrentRuns,
  });
  process.stderr.write(`Workspace E2E capacity insufficient: ${diagnostic}\n`);
  if (environment.GITHUB_ACTIONS === "true") {
    process.stderr.write(
      `::error title=Workspace E2E capacity insufficient::${diagnostic}\n`
    );
  }
  process.exit(1);
}
