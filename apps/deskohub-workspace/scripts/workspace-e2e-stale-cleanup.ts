import "../shared/polyfills/temporal";

import { Effect, Exit, Logger } from "effect";
import { getWorkspaceE2ECapacityInterval } from "../e2e/capacity";
import { getDatasourceConfig } from "../e2e/config";
import { makeE2EEnvironment } from "../e2e/e2e-env";
import { reconcileStaleDotyposReservations } from "../e2e/integrations/dotypos";

const unexpectedArguments = process.argv
  .slice(2)
  .filter((value) => value !== "--apply");
if (unexpectedArguments.length > 0) {
  process.stderr.write("Unsupported Workspace E2E stale cleanup argument.\n");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const environment = makeE2EEnvironment();
const datasourceConfig = getDatasourceConfig(environment);
const interval = getWorkspaceE2ECapacityInterval();
const cleanupExit = await reconcileStaleDotyposReservations(
  datasourceConfig,
  interval,
  apply
).pipe(Effect.provide(Logger.layer([])), Effect.runPromiseExit);

if (Exit.isFailure(cleanupExit)) {
  process.stderr.write("Workspace E2E stale reservation cleanup failed.\n");
  process.exit(1);
}

const report = cleanupExit.value;
process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`);

if (
  report.detailReadFailureCount > 0 ||
  (apply &&
    (report.cancellationFailureCount > 0 ||
      report.cancellationConverged !== true))
) {
  process.exit(1);
}
