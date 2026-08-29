import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Logger, Predicate } from "effect";
import { PayStateTokenError } from "./pay-state";
import { recoverReplacementPayState } from "./replacement-pay-state";

const runWithWarnings = async <A, E>(effect: Effect.Effect<A, E>) => {
  const warnings: string[] = [];
  const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
    const text = Array.isArray(message) ? message[0] : message;
    if (logLevel === "Warn" && Predicate.isString(text)) warnings.push(text);
  });
  const result = await Effect.runPromise(
    effect.pipe(Effect.withLogger(logger))
  );

  return { result, warnings };
};

describe("replacement Pay state", () => {
  test.each(["missing-secret", "invalid-secret"] as const)(
    "falls back when Pay state configuration has %s",
    async (code) => {
      const { result, warnings } = await runWithWarnings(
        recoverReplacementPayState(
          Effect.fail(
            new PayStateTokenError({
              code,
              message: "Pay state configuration is unavailable",
            })
          )
        )
      );

      expect(result).toBeUndefined();
      expect(warnings).toEqual([
        "Replacement Pay state configuration unavailable; loading ordinary availability",
      ]);
    }
  );

  test.each(["invalid-token", "unknown-kid", "expired"] as const)(
    "ignores an unusable customer token with %s",
    async (code) => {
      const { result, warnings } = await runWithWarnings(
        recoverReplacementPayState(
          Effect.fail(new PayStateTokenError({ code, message: "Unusable" }))
        )
      );

      expect(result).toBeUndefined();
      expect(warnings).toEqual([]);
    }
  );

  test("does not hide Pay state defects", async () => {
    const result = await Effect.runPromiseExit(
      recoverReplacementPayState(
        Effect.die(new Error("Unexpected Pay state defect"))
      )
    );

    expect(Exit.isFailure(result)).toBe(true);
    expect(Exit.isFailure(result) && Cause.hasDies(result.cause)).toBe(true);
  });
});
