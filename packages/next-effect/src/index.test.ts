import { describe, expect, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { redirect } from "next/navigation";
import { NextEffect } from ".";

class TestService extends Context.Service<
  TestService,
  { readonly value: string }
>()("@deskohub/next-effect/test/RunnerService") {}

describe("NextEffect", () => {
  test("run provides the configured layer", async () => {
    const next = NextEffect.make({
      layer: Layer.succeed(TestService, { value: "service" }),
    });

    await expect(
      next.run(
        Effect.gen(function* () {
          const service = yield* TestService;
          return service.value;
        })
      )
    ).resolves.toBe("service");
  });

  test("run maps fallible layer setup failures", async () => {
    const mapped = new Error("mapped");
    const next = NextEffect.make({
      layer: Layer.effect(TestService, Effect.fail("setup")),
      mapError: () => mapped,
    });

    await expect(
      next.run(
        Effect.gen(function* () {
          return yield* TestService;
        })
      )
    ).rejects.toBe(mapped);
  });

  test("page passes props into an Effect component", async () => {
    const next = NextEffect.make({
      layer: Layer.succeed(TestService, { value: "service" }),
    });
    const Page = next.page((props: { readonly slug: string }) =>
      Effect.gen(function* () {
        const service = yield* TestService;
        return `${service.value}:${props.slug}`;
      })
    );

    await expect(Page({ slug: "menu" })).resolves.toBe("service:menu");
  });

  test("page preserves Next control-flow throws", async () => {
    const next = NextEffect.make();
    const Page = next.page(() => Effect.sync(() => redirect("/target")));

    await expect(Page({})).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });
});
