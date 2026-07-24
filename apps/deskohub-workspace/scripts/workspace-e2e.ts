import "../shared/polyfills/temporal";

import { Cause, Exit } from "effect";
import { makeE2EEnvironment } from "../e2e/e2e-env";
import { formatWorkspaceE2EFailure } from "../e2e/errors";
import {
  makeE2ETelemetryRuntime,
  runE2EEffect,
} from "../e2e/telemetry-runtime";
import { makeWorkspaceE2E } from "../e2e/workspace-e2e";

const environment = makeE2EEnvironment();
const telemetry = makeE2ETelemetryRuntime(environment);
const exit = await runE2EEffect(
  makeWorkspaceE2E(environment),
  telemetry.loggerLayer
);
await runE2EEffect(telemetry.shutdown, telemetry.loggerLayer);

if (Exit.isFailure(exit)) {
  process.stderr.write(
    `${formatWorkspaceE2EFailure(Cause.squash(exit.cause))}\n`
  );
  process.exit(1);
}
