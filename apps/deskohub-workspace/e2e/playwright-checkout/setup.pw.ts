import "../../shared/polyfills/temporal";

import { test } from "@playwright/test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { assertNexiSandbox, getConfig, getDatasourceConfig } from "../config";
import { makeWorkspaceE2EEnvironment } from "../e2e-env";
import { assertPreviewEndpointsReady } from "../preview-readiness";
import { addDatabaseUrlRedactions, assertSafeDatabaseUrl } from "../runtime";
import {
  type E2ERunContext,
  E2ERunContextService,
  E2ETelemetryService,
  makeE2ERunContext,
} from "../services/telemetry";
import { makeE2ETelemetryRuntime, runE2EEffect } from "../telemetry-runtime";
import { writeWorkspaceE2ERunContext } from "./run-context";
import { readExternalParentSpan } from "./trace-parent";

test("validate workspace preview readiness", async () => {
  const environment = makeWorkspaceE2EEnvironment();
  const config = getConfig(environment);
  const datasourceConfig = getDatasourceConfig(environment);
  const runContext = readRunContext(environment);
  assertSafeDatabaseUrl(
    datasourceConfig.databaseUrl,
    "DATABASE_URL",
    environment.WORKSPACE_E2E_DATABASE_ALLOWLIST
  );
  assertSafeDatabaseUrl(
    datasourceConfig.databaseUrlUnpooled,
    "WORKSPACE_E2E_DATABASE_URL_UNPOOLED",
    environment.WORKSPACE_E2E_DATABASE_ALLOWLIST
  );
  assertNexiSandbox(datasourceConfig.nexiApiOrigin);
  addDatabaseUrlRedactions(
    environment.WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL
  );
  await writeWorkspaceE2ERunContext(runContext);

  const telemetry = makeE2ETelemetryRuntime(environment);
  const layer = Layer.mergeAll(
    FetchHttpClient.layer,
    E2ETelemetryService.Default.pipe(
      Layer.provideMerge(E2ERunContextService.layerValue(runContext))
    )
  ).pipe(Layer.provideMerge(telemetry.tracingLayer));
  const runtime = ManagedRuntime.make(layer);
  const parentSpan = readExternalParentSpan(
    environment.WORKSPACE_E2E_TRACE_PARENT
  );

  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const e2eTelemetry = yield* E2ETelemetryService;
        yield* e2eTelemetry.tracePhase({
          effect: assertPreviewEndpointsReady(config),
          phaseId: "preview-readiness",
        });
      }).pipe((effect) =>
        parentSpan ? Effect.withParentSpan(effect, parentSpan) : effect
      )
    );
  } finally {
    await runtime.dispose();
    await runE2EEffect(Effect.void, telemetry);
  }
});

const readRunContext = (
  environment: ReturnType<typeof makeWorkspaceE2EEnvironment>
): E2ERunContext => {
  const serialized = environment.WORKSPACE_E2E_RUN_CONTEXT;
  if (!serialized) return makeE2ERunContext(environment);
  const value: unknown = JSON.parse(serialized);
  if (
    typeof value !== "object" ||
    value === null ||
    !("runId" in value) ||
    !("allocation" in value)
  ) {
    throw new Error("Invalid workspace E2E run context");
  }
  return value as E2ERunContext;
};
