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
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
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
      execute(
        Effect.provide(
          effect,
          Layer.succeed(TestService, { value: "provided" })
        )
      )
    ).resolves.toBe("provided");
  });

  test("maps fallible layer setup failures", async () => {
    const mapped = new Error("mapped setup");

    await expect(
      execute(
        Effect.provide(
          TestService,
          Layer.effect(TestService, Effect.fail("setup"))
        ),
        {
          mapError: () => mapped,
        }
      )
    ).rejects.toBe(mapped);
  });

  test("interprets success and typed failure from an injected Exit runner", async () => {
    let calls = 0;
    const runExit = async <A, E>(effect: Effect.Effect<A, E, never>) => {
      calls += 1;
      return Effect.runPromiseExit(effect);
    };

    await expect(
      execute(Effect.succeed("injected"), { runExit })
    ).resolves.toBe("injected");
    await expect(execute(Effect.fail("failure"), { runExit })).rejects.toBe(
      "failure"
    );
    expect(calls).toBe(2);
  });

  test("preserves Next control flow from an injected Exit runner", async () => {
    const runExit = <A, E>(
      effect: Effect.Effect<A, E, never>,
      options?: { readonly signal?: AbortSignal }
    ) => Effect.runPromiseExit(effect, options);

    await expect(
      execute(
        Effect.sync(() => redirect("/injected")),
        { runExit }
      )
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    await expect(
      execute(
        Effect.sync(() => notFound()),
        { runExit }
      )
    ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  test("normalizes injected runner throws and rejections into defects", async () => {
    const thrown = new Error("runner threw");
    const rejected = new Error("runner rejected");

    await expect(
      execute(Effect.succeed("unused"), {
        runExit: () => {
          throw thrown;
        },
      })
    ).rejects.toBe(thrown);
    await expect(
      execute(Effect.succeed("unused"), {
        runExit: () => Promise.reject(rejected),
      })
    ).rejects.toBe(rejected);
  });

  test("forwards an explicit signal to the injected Exit runner", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    await expect(
      execute(Effect.succeed("ok"), {
        signal: controller.signal,
        runExit: async <A, E>(
          effect: Effect.Effect<A, E, never>,
          options?: { readonly signal?: AbortSignal }
        ) => {
          receivedSignal = options?.signal;
          return Effect.runPromiseExit(effect);
        },
      })
    ).resolves.toBe("ok");
    expect(receivedSignal).toBe(controller.signal);
  });
});

if (process.env.NEXT_EFFECT_EXECUTOR_TYPECHECK === "1") {
  execute(Effect.void, {
    run: (effect) => Effect.runPromise(effect),
    // @ts-expect-error custom value and Exit runners are mutually exclusive.
    runExit: (effect) => Effect.runPromiseExit(effect),
  });
}
