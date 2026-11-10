import { expect } from "bun:test";
import {
  type Context,
  Effect,
  type Exit,
  Logger,
  Predicate,
  References,
} from "effect";

/** The annotations one log row carries. */
export type LogRowAnnotations = Context.Service.Shape<
  typeof References.CurrentLogAnnotations
>;

/**
 * Runs an effect and records the annotations of every row it logs at the
 * minimum log level in effect, beside the effect's exit.
 */
export const captureLogAnnotationsWithExit = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<
  {
    readonly rows: readonly LogRowAnnotations[];
    readonly exit: Exit.Exit<A, E>;
  },
  never,
  R
> =>
  Effect.suspend(() => {
    const rows: LogRowAnnotations[] = [];
    const captureLogger = Logger.make(({ fiber }) => {
      rows.push({ ...fiber.getRef(References.CurrentLogAnnotations) });
    });

    return effect.pipe(
      Effect.exit,
      Effect.provide(Logger.layer([captureLogger])),
      Effect.map((exit) => ({ rows, exit }))
    );
  });

/**
 * Asserts that rows were logged and that each annotation they carry is a
 * scalar: an id, state, count or flag, never a record or a list, which would
 * ride on every later row of its scope. `exempt` names keys a row's own
 * logger owns.
 */
export const expectScalarLogAnnotations = (
  rows: readonly LogRowAnnotations[],
  options: { readonly exempt?: readonly string[] } = {}
) => {
  expect(rows.length).toBeGreaterThan(0);
  const exempt = new Set(options.exempt);
  const nonScalar = rows.flatMap((row) =>
    Object.entries(row)
      .filter(([key, value]) => !exempt.has(key) && Predicate.isObject(value))
      .map(([key, value]) => ({
        key,
        kind: Array.isArray(value) ? "array" : "object",
      }))
  );
  expect(nonScalar).toEqual([]);
};
