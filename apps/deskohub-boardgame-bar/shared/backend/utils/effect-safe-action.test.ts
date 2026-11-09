import { describe, expect, mock, test } from "bun:test";
import { Data, Effect, Layer } from "effect";
import { z } from "zod";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";

setBoardgameTestEnv();

mock.module("next/headers", () => ({
  cookies: mock(async () => ({ get: () => undefined })),
  headers: mock(async () => new Headers({ cookie: "PARAGLIDE_LOCALE=en-US" })),
}));

class TestActionError extends Data.TaggedError("TestActionError")<{
  readonly message: string;
}> {}

describe("createEffectSafeAction", () => {
  test("failing handler returns a server error", async () => {
    const { createEffectSafeAction } = await import("./effect-safe-action");
    const action = createEffectSafeAction(
      z.object({ name: z.string() }),
      () => Effect.fail(new TestActionError({ message: "nope" })),
      Layer.empty
    );

    const result = await action({ name: "Ada" });

    expect(result).toEqual({
      serverError: "Something went wrong while executing the operation.",
    });
  });
});
