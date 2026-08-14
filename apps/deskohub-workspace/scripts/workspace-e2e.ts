import "../shared/polyfills/temporal";

import { Cause, Effect, Exit, Layer } from "effect";
import { makeWorkspaceE2EEnvironment } from "../e2e/e2e-env";
import { formatWorkspaceE2EFailure, workspaceE2EError } from "../e2e/errors";
import { workspaceDir } from "../e2e/runtime";
import {
  E2ERunContextService,
  E2ETelemetryService,
  makeE2ERunContext,
} from "../e2e/services/telemetry";
import {
  makeE2ETelemetryRuntime,
  runE2EEffect,
} from "../e2e/telemetry-runtime";

const environment = makeWorkspaceE2EEnvironment();
const runContext = makeE2ERunContext(environment);
const telemetry = makeE2ETelemetryRuntime(environment);
const telemetryServiceLayer = E2ETelemetryService.Default.pipe(
  Layer.provide(E2ERunContextService.layerValue(runContext))
);
const playwrightEnvironment = Object.fromEntries(
  Object.entries(environment).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, String(value)]]
  )
);
const runPlaywright = Effect.gen(function* () {
  const e2eTelemetry = yield* E2ETelemetryService;
  yield* e2eTelemetry.traceRun(
    Effect.gen(function* () {
      const span = yield* Effect.currentSpan;
      const exitCode = yield* Effect.tryPromise({
        catch: (cause) =>
          workspaceE2EError("Could not launch Playwright checkout E2E", {
            cause,
            operation: "launch Playwright checkout E2E",
          }),
        try: async () => {
          const child = Bun.spawn(
            [
              "bunx",
              "playwright",
              "test",
              "--config",
              "playwright.e2e.config.ts",
            ],
            {
              cwd: workspaceDir,
              env: {
                ...playwrightEnvironment,
                WORKSPACE_E2E_RUN_CONTEXT: JSON.stringify(runContext),
                WORKSPACE_E2E_TRACE_PARENT: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`,
              },
              stderr: "inherit",
              stdin: "inherit",
              stdout: "inherit",
            }
          );
          return child.exited;
        },
      });
      if (exitCode !== 0) {
        return yield* workspaceE2EError(
          `Playwright checkout E2E exited with ${exitCode}`,
          { operation: "run Playwright checkout E2E" }
        );
      }
    })
  );
}).pipe(Effect.provide(telemetryServiceLayer));
const exit = await runE2EEffect(runPlaywright, telemetry);

if (Exit.isFailure(exit)) {
  process.stderr.write(
    `${formatWorkspaceE2EFailure(Cause.squash(exit.cause))}\n`
  );
  process.exit(1);
}
