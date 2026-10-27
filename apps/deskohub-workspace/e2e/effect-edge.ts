import { Cause, Effect, Exit, Fiber } from "effect";

const abortReason = (signal: AbortSignal) =>
  signal.reason ?? new DOMException("Aborted", "AbortError");

/**
 * The shared E2E Effect edge for code that runs outside a case runtime, such
 * as the argv Runner and `runE2EEffect`. It provides no tracer;
 * `runE2EEffect` adds the trace export for a whole run. It settles exactly
 * like `Effect.runPromise`, except that a run whose `signal` aborts before it
 * settles rejects as soon as the signal aborts, with the signal's reason or
 * an `AbortError` without one; the run's interruption and finalizers finish
 * in the background. The abort wins even when the run recovers from the
 * interrupt or a failing finalizer replaces it in the cause. An already
 * aborted signal rejects with its reason as is before the run starts.
 */
export const runUntracedE2EEffect = async <A, E>(
  effect: Effect.Effect<A, E>,
  options?: { readonly signal?: AbortSignal }
): Promise<A> => {
  const signal = options?.signal;
  // Effect ignores an aborted signal when the run completes synchronously.
  if (signal?.aborted) throw signal.reason;
  // The signal interrupts the run without awaiting it, and stops the join at
  // once, so the abort never waits for the run's finalizers.
  // biome-ignore lint/plugin: this is the shared E2E Effect edge.
  const run = Effect.runFork(effect, options);
  // biome-ignore lint/plugin: this is the shared E2E Effect edge.
  const exit = await Effect.runPromiseExit(Fiber.join(run), options);
  if (signal?.aborted) throw abortReason(signal);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
};
