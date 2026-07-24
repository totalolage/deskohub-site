import "../shared/polyfills/temporal";

import { Cause, Exit } from "effect";
import { formatWorkspaceE2EFailure } from "../e2e/errors";
import {
  loadLocalE2EEnvironment,
  makeE2ETelemetryRuntime,
  runE2EEffect,
} from "../e2e/telemetry-runtime";
import { workspaceE2E } from "../e2e/workspace-e2e";

await loadLocalE2EEnvironment();
const telemetry = makeE2ETelemetryRuntime();
const exit = await runE2EEffect(workspaceE2E, telemetry.loggerLayer);
await telemetry.shutdown();

if (Exit.isFailure(exit)) {
  process.stderr.write(
    `${formatWorkspaceE2EFailure(Cause.squash(exit.cause))}\n`
  );
  process.exit(1);
}
