import { expect } from "bun:test";
import { Effect, type Exit, Logger, Predicate, References } from "effect";

export interface LoggedDatabaseQuery {
  readonly query: string;
  readonly params: readonly unknown[];
}

/**
 * Runs an effect at the Debug minimum log level, where the Workspace database
 * query logger attaches each statement's SQL text and censored parameters.
 * Above Debug, as in production, a query row carries its parameter count only.
 */
export const withDatabaseQueryDetail = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.provideService(effect, References.MinimumLogLevel, "Debug");

/**
 * Runs an effect with query detail (`withDatabaseQueryDetail`) and records
 * what the Workspace database query logger emits for each statement, after
 * censorship, beside the effect's exit.
 */
export const captureDatabaseQueryLogsWithExit = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<
  {
    readonly logs: readonly LoggedDatabaseQuery[];
    readonly exit: Exit.Exit<A, E>;
  },
  never,
  R
> =>
  Effect.suspend(() => {
    const logged: LoggedDatabaseQuery[] = [];
    const captureLogger = Logger.make((options) => {
      const annotations = options.fiber.getRef(
        References.CurrentLogAnnotations
      );
      if (
        Predicate.isString(annotations.query) &&
        Array.isArray(annotations.params)
      ) {
        logged.push({ query: annotations.query, params: annotations.params });
      }
    });

    return effect.pipe(
      Effect.exit,
      withDatabaseQueryDetail,
      Effect.provide(Logger.layer([captureLogger])),
      Effect.map((exit) => ({ logs: logged, exit }))
    );
  });

/**
 * Runs an effect and records what the Workspace database query logger emits
 * for each statement, after censorship. The effect's own outcome is ignored so
 * tests can drive a call site against canned rows that make it fail later.
 */
export const captureDatabaseQueryLogs = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<readonly LoggedDatabaseQuery[], never, R> =>
  captureDatabaseQueryLogsWithExit(effect).pipe(Effect.map(({ logs }) => logs));

/** Runs `captureDatabaseQueryLogs` for an effect without requirements. */
export const collectDatabaseQueryLogs = <A, E>(
  effect: Effect.Effect<A, E>
): Promise<readonly LoggedDatabaseQuery[]> =>
  Effect.runPromise(captureDatabaseQueryLogs(effect));

/**
 * Asserts that statements were logged and none of them carries a confidential
 * value. Against a live database, pair it with a read showing the value was
 * stored, which proves a logged statement bound it.
 */
export const expectQueryLogsToOmit = (input: {
  readonly logs: readonly LoggedDatabaseQuery[];
  readonly values: readonly string[];
}) => {
  expect(input.logs.length).toBeGreaterThan(0);
  const serializedLogs = JSON.stringify(input.logs);
  for (const value of input.values) {
    expect(serializedLogs).not.toContain(value);
  }
};
