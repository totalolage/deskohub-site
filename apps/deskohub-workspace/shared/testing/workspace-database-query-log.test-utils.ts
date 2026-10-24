import { expect } from "bun:test";
import { Effect, Logger, Predicate, References } from "effect";
import type { RecordingWorkspaceDatabase } from "./workspace-recording-database.test-utils";

export interface LoggedDatabaseQuery {
  readonly query: string;
  readonly params: readonly unknown[];
}

/**
 * Runs an effect and records what the Workspace database query logger emits
 * for each statement, after censorship. The effect's own outcome is ignored so
 * tests can drive a call site against canned rows that make it fail later.
 */
export const collectDatabaseQueryLogs = async <A, E>(
  effect: Effect.Effect<A, E>
): Promise<readonly LoggedDatabaseQuery[]> => {
  const logged: LoggedDatabaseQuery[] = [];
  const captureLogger = Logger.make((options) => {
    const annotations = options.fiber.getRef(References.CurrentLogAnnotations);
    if (
      Predicate.isString(annotations.query) &&
      Array.isArray(annotations.params)
    ) {
      logged.push({ query: annotations.query, params: annotations.params });
    }
  });

  await effect.pipe(
    Effect.exit,
    Effect.provide(Logger.layer([captureLogger])),
    Effect.runPromise
  );

  return logged;
};

/**
 * Asserts that each confidential value reached the database as a bound
 * parameter of a logged statement, yet never appears in the query log.
 */
export const expectQueryLogsToCensor = (input: {
  readonly recording: Pick<RecordingWorkspaceDatabase, "statements">;
  readonly logs: readonly LoggedDatabaseQuery[];
  readonly values: readonly string[];
}) => {
  for (const value of input.values) {
    const statement = input.recording.statements.find(({ params }) =>
      params.includes(value)
    );
    expect(statement).toBeDefined();
    expect(input.logs.map(({ query }) => query)).toContain(statement!.sql);
  }

  expectQueryLogsToOmit(input);
};

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
