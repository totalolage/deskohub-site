import { Effect, Predicate, Schedule } from "effect";

export const retryDatabaseRead = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.retry({
      schedule: Schedule.spaced("100 millis"),
      times: 1,
      while: (error) => Predicate.isTagged(error, "EffectDrizzleQueryError"),
    })
  );
