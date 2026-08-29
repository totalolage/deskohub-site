import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect, Predicate, Schedule } from "effect";
import * as SqlError from "effect/unstable/sql/SqlError";

const isRetryableDatabaseReadError = <E>(error: E) =>
  error instanceof EffectDrizzleQueryError &&
  Cause.isCause(error.cause) &&
  error.cause.reasons.some(
    (reason) =>
      Cause.isFailReason(reason) &&
      SqlError.isSqlError(reason.error) &&
      (reason.error.isRetryable ||
        (reason.error.reason._tag === "UnknownError" &&
          reason.error.reason.operation === "acquireConnection" &&
          (!Predicate.hasProperty(reason.error.reason.cause, "code") ||
            !Predicate.isString(reason.error.reason.cause.code))))
  );

export const retryDatabaseRead = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.retry({
      schedule: Schedule.spaced("100 millis"),
      times: 1,
      while: isRetryableDatabaseReadError,
    })
  );
