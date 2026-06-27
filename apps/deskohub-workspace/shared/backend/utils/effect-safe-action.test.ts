import { expect, mock, test } from "bun:test";
import { Context, Effect, Layer, Schema } from "effect";

mock.module("next/headers", () => ({
  cookies: async () => ({ getAll: () => [] }),
  headers: async () => new Headers({ referer: "https://deskohub.test/en-US" }),
}));

interface TestMultiplierService {
  readonly multiplyBy: number;
}

class TestMultiplier extends Context.Service<
  TestMultiplier,
  TestMultiplierService
>()("TestMultiplier") {}

test("decodes Standard Schema input, runs with layers, and preserves public errors", async () => {
  const { createEffectSafeAction } = await import("./effect-safe-action");
  const { PublicSafeActionError } = await import(
    "@/shared/utils/safe-action-client"
  );
  const seen = mock((value: number) => value);

  const action = createEffectSafeAction(
    Schema.toStandardSchemaV1(Schema.NumberFromString),
    (input) =>
      Effect.gen(function* () {
        seen(input);
        const multiplier = yield* TestMultiplier;
        if (input === 13) {
          return yield* Effect.fail(
            new PublicSafeActionError({ message: "public failure" })
          );
        }

        return input * multiplier.multiplyBy;
      }),
    Layer.succeed(TestMultiplier, { multiplyBy: 2 })
  );

  const success = await action("21");
  const failure = await action("13");

  expect(success.data).toBe(42);
  expect(failure.serverError).toBe("public failure");
  expect(seen.mock.calls).toEqual([[21], [13]]);
});
