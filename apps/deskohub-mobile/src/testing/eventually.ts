import { Effect } from "effect";

/**
 * Waits in real time until `check` holds, for work that settles on later
 * tasks (in-memory requests, registry updates) even under a test clock.
 */
export const eventually = (check: () => boolean) =>
  Effect.promise(async () => {
    for (let turn = 0; turn < 500; turn++) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error("the condition never held");
  });

/** Gives in-flight work a few real turns, to assert that nothing more happens. */
export const quietly = Effect.promise(
  () => new Promise((resolve) => setTimeout(resolve, 20))
);
