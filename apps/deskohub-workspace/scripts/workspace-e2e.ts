import "../shared/polyfills/temporal";

import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Layer } from "effect";
import {
  makeWorkspaceE2EEnvironment,
  toPlaywrightEnvironment,
} from "../e2e/e2e-env";
import { formatWorkspaceE2EFailure, workspaceE2EError } from "../e2e/errors";
import { hasWorkspaceE2ERunContext } from "../e2e/playwright-checkout/run-context";
import {
  runWorkspacePlaywrightSuites,
  workspacePlaywrightProcessEnvironment,
} from "../e2e/playwright-runner";
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
const playwrightEnvironment = toPlaywrightEnvironment(environment);
const toInstantNavigationError = (
  instantNavigation: PromiseSettledResult<number>
) => {
  if (instantNavigation.status === "rejected") {
    return workspaceE2EError(
      "Could not launch Playwright instant navigation E2E",
      {
        cause: instantNavigation.reason,
        operation: "launch Playwright instant navigation E2E",
      }
    );
  }
  if (instantNavigation.value === 0) return undefined;
  return workspaceE2EError(
    `Playwright instant navigation E2E exited with ${instantNavigation.value}`,
    { operation: "run Playwright instant navigation E2E" }
  );
};
const runPlaywright = Effect.gen(function* () {
  const e2eTelemetry = yield* E2ETelemetryService;
  yield* e2eTelemetry.traceRun(
    Effect.gen(function* () {
      const span = yield* Effect.currentSpan;
      const spawnPlaywright = (
        config: string,
        options: readonly string[] = []
      ) =>
        Bun.spawn(
          ["bunx", "playwright", "test", "--config", config, ...options],
          {
            cwd: workspaceDir,
            env: workspacePlaywrightProcessEnvironment({
              config,
              environment: {
                ...playwrightEnvironment,
                WORKSPACE_E2E_RUN_CONTEXT: JSON.stringify(runContext),
                WORKSPACE_E2E_TRACE_PARENT: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`,
              },
            }),
            stderr: "inherit",
            stdin: "inherit",
            stdout: "inherit",
          }
        ).exited;
      // Read-only instant navigation runs beside the checkout graph instead
      // of gating its setup phase; both always target the remote preview.
      const { checkout, instantNavigation } = yield* Effect.promise(() =>
        runWorkspacePlaywrightSuites({
          checkout: (invocation) =>
            spawnPlaywright(
              "playwright.e2e.config.ts",
              invocation === "failure-cleanup"
                ? [
                    "--project=checkout-cleanup",
                    "--no-deps",
                    `--output=e2e-artifacts/checkout-cleanup-recovery-${randomUUID()}`,
                  ]
                : []
            ),
          hasCheckoutRunContext: hasWorkspaceE2ERunContext,
          instantNavigation: () =>
            spawnPlaywright("playwright.instant-navigation.config.ts"),
        })
      );
      const instantNavigationError =
        toInstantNavigationError(instantNavigation);
      // The checkout outcome is reported first; an instant navigation
      // failure is logged beside it rather than replacing it.
      const reportInstantNavigationFailure = () => {
        if (instantNavigationError) {
          process.stderr.write(
            `${formatWorkspaceE2EFailure(instantNavigationError)}\n`
          );
        }
      };
      if (checkout.status === "rejected") {
        reportInstantNavigationFailure();
        return yield* workspaceE2EError("Could not launch Playwright E2E", {
          cause: checkout.reason,
          operation: "launch Playwright checkout E2E",
        });
      }
      const result = checkout.value;
      if (result.cleanupSkippedWithoutRunContext) {
        process.stderr.write(
          "Workspace E2E cleanup-only project skipped: the main suite failed before setup recorded its run context, so it leased and seeded nothing.\n"
        );
      } else if (result.cleanupCouldNotStart) {
        process.stderr.write(
          "Workspace E2E cleanup-only project could not start after the main suite failed.\n"
        );
      } else if (
        result.cleanupExitCode !== undefined &&
        result.cleanupExitCode !== 0
      ) {
        process.stderr.write(
          `Workspace E2E cleanup-only project exited with ${result.cleanupExitCode} after the main suite failed.\n`
        );
      }
      if (result.suiteExitCode !== 0) {
        reportInstantNavigationFailure();
        return yield* workspaceE2EError(
          `Playwright checkout E2E exited with ${result.suiteExitCode}`,
          { operation: "run Playwright checkout E2E" }
        );
      }
      if (instantNavigationError) return yield* instantNavigationError;
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
