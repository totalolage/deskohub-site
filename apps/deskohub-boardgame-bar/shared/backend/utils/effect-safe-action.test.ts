import { describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { z } from "zod";

mock.module("next/headers", () => ({
  cookies: mock(async () => ({ get: () => undefined })),
  headers: mock(async () => new Headers({ cookie: "PARAGLIDE_LOCALE=en-US" })),
}));

class TestService extends Context.Service<
  TestService,
  { readonly value: string }
>()("TestService") {}

describe("createEffectSafeAction", () => {
  test("succeeds with fake layer and locale", async () => {
    const { createEffectSafeAction } = await import("./effect-safe-action");
    const action = createEffectSafeAction(
      z.object({ name: z.string() }),
      (input, { locale }) =>
        Effect.gen(function* () {
          const service = yield* TestService;
          return { input, locale, service: service.value };
        }),
      Layer.succeed(TestService, { value: "fake" })
    );

    const result = await action({ name: "Ada" });

    expect(result).toEqual({
      data: { input: { name: "Ada" }, locale: "en-US", service: "fake" },
    });
  });

  test("failing handler returns a server error", async () => {
    const { createEffectSafeAction } = await import("./effect-safe-action");
    const action = createEffectSafeAction(
      z.object({ name: z.string() }),
      () => Effect.fail(new Error("nope")),
      Layer.empty
    );

    const result = await action({ name: "Ada" });

    expect(result).toEqual({
      serverError: "Something went wrong while executing the operation.",
    });
  });
});
