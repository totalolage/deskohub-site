import { test as base } from "@playwright/test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { getDatasourceConfig } from "../config";
import { makeWorkspaceE2EEnvironment } from "../e2e-env";
import { E2EDatabase } from "../integrations/database.service";
import { addDatabaseUrlRedactions } from "../runtime";
import {
  type E2ERunContext,
  E2ERunContextService,
  E2ETelemetryService,
} from "../services/telemetry";
import { makeE2ETelemetryRuntime, runE2EEffect } from "../telemetry-runtime";
import { readWorkspaceE2ERunContext } from "./run-plan";
import { readExternalParentSpan } from "./trace-parent";

type CleanupRuntimeFixtures = {
  readonly environment: ReturnType<typeof makeWorkspaceE2EEnvironment>;
  readonly runContext: E2ERunContext;
  readonly runEffect: <A, E>(
    effect: Effect.Effect<A, E, E2EDatabase | E2ETelemetryService>
  ) => Promise<A>;
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
    async ({ environment, runContext }, use) => {
      const datasourceConfig = getDatasourceConfig(environment);
      addDatabaseUrlRedactions(datasourceConfig.databaseUrlUnpooled);
      const telemetry = makeE2ETelemetryRuntime(environment);
      const layer = Layer.mergeAll(
        E2EDatabase.layer(datasourceConfig),
        E2ETelemetryService.Default.pipe(
          Layer.provideMerge(E2ERunContextService.layerValue(runContext))
        )
      ).pipe(Layer.provideMerge(telemetry.tracingLayer));
      const runtime = ManagedRuntime.make(layer);
      const parentSpan = readExternalParentSpan(
        environment.WORKSPACE_E2E_TRACE_PARENT
      );
      const runEffect = <A, E>(
        effect: Effect.Effect<A, E, E2EDatabase | E2ETelemetryService>
      ) =>
        runtime.runPromise(
          parentSpan ? effect.pipe(Effect.withParentSpan(parentSpan)) : effect
        );

      try {
        await use(runEffect);
      } finally {
        await runtime.dispose();
        await runE2EEffect(Effect.void, telemetry);
      }
    },
    { scope: "worker" },
  ],
});
