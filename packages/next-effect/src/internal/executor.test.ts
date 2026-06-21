import { describe, expect, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { notFound, redirect } from "next/navigation";
import { execute } from "./executor";

class TestService extends Context.Service<
  TestService,
  { readonly value: string }
>()("@deskohub/next-effect/test/TestService") {}

describe("execute", () => {
  test("returns successful values", async () => {
    await expect(execute(Effect.succeed("ok"))).resolves.toBe("ok");
  });

  test("maps typed failures when mapError is provided", async () => {
    const mapped = new Error("mapped");

    await expect(
      execute(Effect.fail("domain"), {
        mapError: () => mapped,
      })
    ).rejects.toBe(mapped);
  });

  test("rejects typed failures directly without mapError", async () => {
    const failure: { readonly _tag: "DomainError" } = { _tag: "DomainError" };

    await expect(execute(Effect.fail(failure))).rejects.toBe(failure);
  });

  test("rejects defects without swallowing them", async () => {
    const defect = new Error("boom");

    await expect(execute(Effect.die(defect))).rejects.toBe(defect);
  });

  test("preserves Next redirect control-flow defects", async () => {
    await expect(
      execute(Effect.sync(() => redirect("/target")))
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });

  test("preserves Next notFound control-flow defects", async () => {
    await expect(execute(Effect.sync(() => notFound()))).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });

  test("provides services from the supplied layer", async () => {
    const effect = Effect.gen(function* () {
      const service = yield* TestService;
      return service.value;
    });

    await expect(
      execute(Effect.provide(effect, Layer.succeed(TestService, { value: "provided" })))
    ).resolves.toBe("provided");
  });

  test("maps fallible layer setup failures", async () => {
    const mapped = new Error("mapped setup");

    await expect(
      execute(
        Effect.provide(
          Effect.gen(function* () {
            return yield* TestService;
          }),
          Layer.effect(TestService, Effect.fail("setup"))
        ),
        {
          mapError: () => mapped,
        }
      )
    ).rejects.toBe(mapped);
  });
});
