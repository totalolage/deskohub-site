import "../../shared/polyfills/temporal";

import { test as base } from "@playwright/test";
import { Effect, Layer, ManagedRuntime, Tracer } from "effect";
import type { HttpClient } from "effect/unstable/http";
import { makeWorkspaceE2EEnvironment } from "../e2e-env";
import type { E2EDatabase } from "../integrations/database.service";
import type { WorkspaceE2ECaseService } from "../services/cases";
import { makeWorkspaceE2ECaseRuntimeLive } from "../services/runner";
import type { E2ETelemetryService } from "../services/telemetry";
import { makeE2ETelemetryRuntime, runE2EEffect } from "../telemetry-runtime";
import { readWorkspaceE2ERunContext } from "./run-plan";

type WorkspaceE2ERuntimeServices =
  | E2EDatabase
  | E2ETelemetryService
  | HttpClient.HttpClient
  | WorkspaceE2ECaseService;

export type WorkspaceE2EEffectRunner = <
  A,
  E,
  R extends WorkspaceE2ERuntimeServices,
>(
  effect: Effect.Effect<A, E, R>
) => Promise<A>;

type WorkspaceE2ERuntimeFixtures = {
  readonly environment: ReturnType<typeof makeWorkspaceE2EEnvironment>;
  readonly runContext: Awaited<ReturnType<typeof readWorkspaceE2ERunContext>>;
  readonly runEffect: WorkspaceE2EEffectRunner;
};

export const runtimeTest = base.extend<
  Record<never, never>,
  WorkspaceE2ERuntimeFixtures
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
      const telemetry = makeE2ETelemetryRuntime(environment);
      const layer = makeWorkspaceE2ECaseRuntimeLive(
        environment,
        runContext
      ).pipe(Layer.provideMerge(telemetry.tracingLayer));
      const runtime = ManagedRuntime.make(layer);
      const parentSpan = readExternalParentSpan(
        environment.WORKSPACE_E2E_TRACE_PARENT
      );
      const runEffect: WorkspaceE2EEffectRunner = (effect) =>
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

export const readExternalParentSpan = (
  traceParent: string | undefined
): Tracer.ExternalSpan | undefined => {
  if (!traceParent) return undefined;
  const [version, traceId, spanId, flags] = traceParent.split("-");
  if (
    version !== "00" ||
    !traceId?.match(/^[0-9a-f]{32}$/) ||
    !spanId?.match(/^[0-9a-f]{16}$/) ||
    !flags?.match(/^[0-9a-f]{2}$/)
  ) {
    throw new Error("Invalid workspace E2E trace parent");
  }
  return Tracer.externalSpan({
    sampled: (Number.parseInt(flags, 16) & 1) === 1,
    spanId,
    traceId,
  });
};
