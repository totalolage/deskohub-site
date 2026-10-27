import { Effect, type Exit } from "effect";

/**
 * The E2E process's one Effect edge: E2E source outside tests and case
 * runtimes enters Effect only here. It provides no tracer; `runE2EEffect`
 * adds the trace export for a whole run. Aborting `signal` interrupts the
 * Effect, which then settles with an interrupted Exit.
 */
export const runUntracedE2EEffect = <A, E>(
  effect: Effect.Effect<A, E>,
  options?: { readonly signal?: AbortSignal }
): Promise<Exit.Exit<A, E>> =>
  // biome-ignore lint/plugin: this is the E2E process's Effect edge.
  Effect.runPromiseExit(effect, options);
