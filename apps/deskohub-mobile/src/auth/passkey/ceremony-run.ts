import type { Effect, Fiber, ManagedRuntime } from "effect";

/**
 * The ceremony a control runs on `runtime`, at most one at a time: `start`
 * does nothing while one runs, and `interrupt` stops it without reporting an
 * outcome. This is the hook's one run edge.
 */
export const makeCeremonyRun = <R>(
  runtime: ManagedRuntime.ManagedRuntime<R, never>
) => {
  let running: Fiber.Fiber<void> | undefined;
  return {
    start: (ceremony: Effect.Effect<void, never, R>) => {
      if (running) return;
      const fiber = runtime.runFork(ceremony);
      running = fiber;
      // A ceremony can settle before `runFork` returns, such as on a device
      // without passkeys; the observer still runs for it.
      fiber.addObserver(() => {
        if (running === fiber) running = undefined;
      });
    },
    interrupt: () => running?.interruptUnsafe(),
  };
};
