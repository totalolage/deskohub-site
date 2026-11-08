import "../shared/polyfills/temporal";

import { Effect, Exit } from "effect";
import {
  getWorkspaceE2ECapacityFailures,
  getWorkspaceE2ECapacityInterval,
  makeWorkspaceE2ECapacityReport,
} from "../e2e/capacity";
import { getDatasourceConfig } from "../e2e/config";
import { makeE2EEnvironment } from "../e2e/e2e-env";
import { workspaceE2EError } from "../e2e/errors";
import {
  fixtureCapacityLifetime,
  fixtureCapacityReport,
  invalidateFixtureCapacityObservation,
  makeFixtureCapacityObservation,
  writeFixtureCapacityObservation,
} from "../e2e/fixture-capacity";
import { loadDotyposCapacityInventory } from "../e2e/integrations/dotypos";
import { FixtureCapacityReader } from "../e2e/integrations/fixture-capacity";
import { runStandaloneWorkspaceEffect } from "../shared/backend/standalone-workspace-effect";

await invalidateFixtureCapacityObservation();
const environment = makeE2EEnvironment();
const datasourceConfig = getDatasourceConfig(environment);
// This bound starts after queue/lease wait and is enforced by both fixture writers, including local runs.
const startMillis = Date.now();
const endMillis = startMillis + fixtureCapacityLifetime;
const fixtureExit = await Effect.flatMap(FixtureCapacityReader, (reader) =>
  reader.read({
    config: datasourceConfig,
    startMillis,
    endMillis,
  })
).pipe(
  Effect.provide(FixtureCapacityReader.Live),
  Effect.flatMap((inventory) =>
    Effect.try({
      try: () => ({
        inventory,
        observation: makeFixtureCapacityObservation({
          config: datasourceConfig,
          startMillis,
          endMillis,
          observedMillis: Date.now(),
          ...inventory,
        }),
      }),
      catch: () =>
        workspaceE2EError("Synthetic fixture capacity observation is Unknown"),
    })
  ),
  Effect.exit,
  runStandaloneWorkspaceEffect("workspace-e2e.fixture-capacity")
);
if (Exit.isFailure(fixtureExit)) {
  process.stderr.write("Synthetic fixture capacity observation is Unknown\n");
  process.exit(1);
}
const { endDate: to, startDate: from } = getWorkspaceE2ECapacityInterval();
const inventoryExit = await loadDotyposCapacityInventory(datasourceConfig, {
  endDate: to,
  startDate: from,
}).pipe(Effect.exit, runStandaloneWorkspaceEffect("workspace-e2e.capacity"));

if (Exit.isFailure(inventoryExit)) {
  process.stderr.write(
    "Workspace E2E checkout capacity observation is Unknown\n"
  );
  process.exit(1);
}

const report = makeWorkspaceE2ECapacityReport({
  from,
  reservations: inventoryExit.value.reservations,
  tables: inventoryExit.value.tables,
  to,
});

process.stdout.write(
  `${JSON.stringify({ ...report, from: from.toISOString(), to: to.toISOString(), observedAt: new Date().toISOString() }, undefined, 2)}\n`
);
process.stdout.write(
  `${JSON.stringify(
    {
      fixtureCapacity: fixtureCapacityReport(fixtureExit.value.observation),
      read: {
        ...fixtureExit.value.inventory.counts,
        elapsedMilliseconds: fixtureExit.value.inventory.elapsedMilliseconds,
        complete: true,
      },
    },
    undefined,
    2
  )}\n`
);

if (!fixtureExit.value.observation.meetsRequiredCapacity) {
  process.stderr.write("Synthetic fixture capacity insufficient\n");
  process.exit(1);
}

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

await writeFixtureCapacityObservation(fixtureExit.value.observation);
