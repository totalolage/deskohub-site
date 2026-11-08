import { Data, Duration, Effect } from "effect";

export type SmokeCaseGroup = "effect" | "shared" | "intl" | "i18n";

/**
 * One runtime check. `run` returns the value it observed as text and throws
 * (or rejects) when that value is not the expected one.
 */
export type SmokeCase = {
  readonly group: SmokeCaseGroup;
  readonly name: string;
  readonly run: () => Promise<string> | string;
};

export type SmokeResult = {
  readonly group: SmokeCaseGroup;
  readonly name: string;
  readonly status: "PASS" | "FAIL";
  readonly actual: string;
};

export type SmokeReport = {
  readonly results: ReadonlyArray<SmokeResult>;
  readonly passed: number;
  readonly failed: number;
  readonly total: number;
};

class SmokeCaseFailure extends Data.TaggedError("SmokeCaseFailure")<{
  readonly description: string;
}> {}

/** Collapses whitespace and truncates, so one result stays one line. */
export const toOneLine = (text: string, maxLength = 220): string =>
  text.replace(/\s+/g, " ").slice(0, maxLength);

/** Throws the case's mismatch description unless `condition` holds. */
export function assertSmoke(
  condition: unknown,
  mismatch: string
): asserts condition {
  if (!condition) throw new Error(`assertion failed: ${mismatch}`);
}

// Total for anything a case can throw: String() itself throws for an object
// without a prototype, so other objects use Object.prototype.toString.
const describeThrown = (thrown: unknown): string => {
  if (thrown instanceof Error)
    return toOneLine(`${thrown.name}: ${thrown.message}`);
  if (thrown !== null && typeof thrown === "object") {
    return Object.prototype.toString.call(thrown);
  }
  return toOneLine(String(thrown));
};

const runSmokeCase = (
  smokeCase: SmokeCase,
  caseTimeout: Duration.Input
): Effect.Effect<SmokeResult> =>
  Effect.tryPromise({
    try: async () => smokeCase.run(),
    catch: (thrown) =>
      new SmokeCaseFailure({ description: describeThrown(thrown) }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: caseTimeout,
      orElse: () =>
        Effect.fail(
          new SmokeCaseFailure({
            description: `timed out after ${Duration.format(Duration.fromInputUnsafe(caseTimeout))}`,
          })
        ),
    }),
    Effect.match({
      onSuccess: (actual) => ({
        group: smokeCase.group,
        name: smokeCase.name,
        status: "PASS" as const,
        actual,
      }),
      onFailure: (failure) => ({
        group: smokeCase.group,
        name: smokeCase.name,
        status: "FAIL" as const,
        actual: failure.description,
      }),
    })
  );

const toSmokeReport = (results: ReadonlyArray<SmokeResult>): SmokeReport => {
  const passed = results.filter((result) => result.status === "PASS").length;
  return {
    results,
    passed,
    failed: results.length - passed,
    total: results.length,
  };
};

/**
 * Runs the cases one after another, so timing cases don't compete. A case
 * that throws, rejects, or outlives `caseTimeout` fails alone; the rest run.
 *
 * A timeout stops waiting for the case but cannot cancel it: Effect runtimes
 * the case started itself keep going and may overlap later cases. A case that
 * blocks synchronously blocks the timeout too.
 */
export const runSmokeCases = (
  cases: ReadonlyArray<SmokeCase>,
  { caseTimeout = "5 seconds" }: { readonly caseTimeout?: Duration.Input } = {}
): Promise<SmokeReport> =>
  Effect.runPromise(
    Effect.forEach(cases, (smokeCase) =>
      runSmokeCase(smokeCase, caseTimeout)
    ).pipe(Effect.map(toSmokeReport))
  );
