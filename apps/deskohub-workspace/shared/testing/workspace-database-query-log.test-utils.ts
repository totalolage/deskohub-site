import { expect } from "bun:test";
import { Effect, type Exit, Predicate, References } from "effect";
import {
  captureLogAnnotationsWithExit,
  expectScalarLogAnnotations,
  type LogRowAnnotations,
} from "./log-annotations.test-utils";

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

const isDatabaseQueryRow = (
  annotations: LogRowAnnotations
): annotations is LogRowAnnotations & LoggedDatabaseQuery =>
  Predicate.isString(annotations.query) && Array.isArray(annotations.params);

/** The statement fields the Workspace database query logger puts on its row. */
const databaseQueryFields = ["query", "params", "parameterCount"];

/**
 * Runs an effect with query detail (`withDatabaseQueryDetail`) and records
 * the annotations of each Workspace database query row, the scoped
 * annotations of the code that ran the statement included, beside the
 * effect's exit.
 */
export const captureDatabaseQueryRowsWithExit = <A, E, R>(
  effect: Effect.Effect<A, E, R>
) =>
  captureLogAnnotationsWithExit(withDatabaseQueryDetail(effect)).pipe(
    Effect.map(({ rows, exit }) => ({
      rows: rows.filter(isDatabaseQueryRow),
      exit,
    }))
  );

/**
 * Asserts that query rows were logged and that, beside the statement's own
 * fields, each carries only scalar annotations from its scope.
 */
export const expectScalarDatabaseQueryAnnotations = (
  rows: readonly LogRowAnnotations[]
) => expectScalarLogAnnotations(rows, { exempt: databaseQueryFields });

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
  captureDatabaseQueryRowsWithExit(effect).pipe(
    Effect.map(({ rows, exit }) => ({
      logs: rows.map(({ query, params }) => ({ query, params })),
      exit,
    }))
  );

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
