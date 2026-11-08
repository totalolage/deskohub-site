import { Effect, Fiber } from "effect";

/**
 * Runs `effect` to its end even when the caller is interrupted, such as a
 * GET whose client disconnects while it finalizes a payment. The effect runs
 * on its own fiber with the caller's services, so its own timeouts still
 * bound it; an interrupted caller stops only once the effect has ended.
 */
export const runToCompletion = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.forkDetach(effect).pipe(
      Effect.flatMap((fiber) =>
        restore(Fiber.join(fiber)).pipe(
          Effect.onInterrupt(() => Fiber.await(fiber))
        )
      )
    )
  );
