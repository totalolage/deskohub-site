import { Effect, Layer, ManagedRuntime } from "effect";
import type { E2EEnvironment } from "./e2e-env";
import { makeE2ETelemetryRuntime, runE2EEffect } from "./telemetry-runtime";
import { readExternalParentSpan } from "./trace-parent";

/** Runs an Effect that needs `R` on a fixture's runtime. */
export type E2EEffectRunner<R> = <A, E>(
  effect: Effect.Effect<A, E, R>
) => Promise<A>;

type E2ERuntimeDefinition<R, E> = {
  /** Built once, on the first run, and shared by every later run. */
  readonly layer: Layer.Layer<R, E>;
  /**
   * Exports the runtime's spans under the environment's E2E PostHog
   * configuration and parents every run on its `WORKSPACE_E2E_TRACE_PARENT`.
   * Leave it out for an untraced runtime.
   */
  readonly tracing?: E2EEnvironment;
};

/**
 * The body of a worker-scoped Playwright runtime fixture: runs `use` against
 * one `ManagedRuntime` over `layer`, so every run in the worker shares the
 * layer's resources, such as its one database pool. Once `use` settles it
 * disposes the runtime, running the layer's finalizers, and only then
 * flushes and shuts down the trace export, so finalizer spans are exported
 * too.
 */
export const withE2ERuntime = async <R, E, A>(
  { layer, tracing }: E2ERuntimeDefinition<R, E>,
  use: (runEffect: E2EEffectRunner<R>) => Promise<A>
): Promise<A> => {
  const telemetry = tracing && makeE2ETelemetryRuntime(tracing);
  const parentSpan =
    tracing && readExternalParentSpan(tracing.WORKSPACE_E2E_TRACE_PARENT);
  const runtime = ManagedRuntime.make(
    telemetry ? layer.pipe(Layer.provideMerge(telemetry.tracingLayer)) : layer
  );
  const runEffect: E2EEffectRunner<R> = (effect) =>
    runtime.runPromise(
      parentSpan ? effect.pipe(Effect.withParentSpan(parentSpan)) : effect
    );

  try {
    return await use(runEffect);
  } finally {
    await runtime.dispose();
    if (telemetry) await runE2EEffect(Effect.void, telemetry);
  }
};
