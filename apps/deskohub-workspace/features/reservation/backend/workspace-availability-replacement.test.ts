import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Logger } from "effect";
import { recoverReplacementOccupancyExclusion } from "./workspace-availability-replacement";

const runWithWarnings = async <A, E>(effect: Effect.Effect<A, E>) => {
  const warnings: string[] = [];
  const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
    const text = Array.isArray(message) ? message[0] : message;
    if (logLevel === "Warn" && typeof text === "string") warnings.push(text);
  });
  const result = await Effect.runPromise(
    effect.pipe(Effect.withLogger(logger))
  );

  return { result, warnings };
};

describe("replacement availability occupancy exclusion", () => {
  test("preserves a verified current reservation exclusion", async () => {
    const exclusion = { dotyposReservationId: "reservation-123" };

    const result = await Effect.runPromise(
      recoverReplacementOccupancyExclusion(Effect.succeed(exclusion))
    );

    expect(result).toEqual(exclusion);
  });

  test("falls back to ordinary availability when verification is unavailable", async () => {
    const { result, warnings } = await runWithWarnings(
      recoverReplacementOccupancyExclusion(
        Effect.fail(new Error("Dotypos is unavailable"))
      )
    );

    expect(result).toBeUndefined();
    expect(warnings).toEqual([
      "Replacement reservation verification unavailable; loading ordinary availability",
    ]);
  });

  test("does not hide defects in replacement verification", async () => {
    const result = await Effect.runPromiseExit(
      recoverReplacementOccupancyExclusion(
        Effect.die(new Error("Unexpected verification defect"))
      )
    );

    expect(Exit.isFailure(result)).toBe(true);
    expect(Exit.isFailure(result) && Cause.hasDies(result.cause)).toBe(true);
  });
});
