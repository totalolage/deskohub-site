import { Cause, Effect, Exit } from "effect";

const abortReason = (signal: AbortSignal) =>
  signal.reason ?? new DOMException("Aborted", "AbortError");

/**
 * The shared E2E Effect edge for code that runs outside a case runtime, such
 * as the argv Runner and `runE2EEffect`. It provides no tracer;
 * `runE2EEffect` adds the trace export for a whole run. It settles exactly
 * like `Effect.runPromise`, except that a run its `signal` stopped rejects
 * with the signal's reason, or an `AbortError` without one. An already
 * aborted signal rejects before the run starts. The signal interrupts the
 * run, but a failing finalizer replaces the interrupt in the cause, so any
 * failure after the abort counts as stopped.
 */
export const runUntracedE2EEffect = async <A, E>(
  effect: Effect.Effect<A, E>,
  options?: { readonly signal?: AbortSignal }
): Promise<A> => {
  const signal = options?.signal;
  // Effect ignores an aborted signal when the run completes synchronously.
  if (signal?.aborted) throw abortReason(signal);
  // biome-ignore lint/plugin: this is the shared E2E Effect edge.
  const exit = await Effect.runPromiseExit(effect, options);
  if (Exit.isSuccess(exit)) return exit.value;
  if (signal?.aborted) throw abortReason(signal);
  throw Cause.squash(exit.cause);
};
