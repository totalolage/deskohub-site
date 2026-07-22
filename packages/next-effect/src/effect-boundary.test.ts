import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { EffectBoundary } from "./effect-boundary";

describe("EffectBoundary", () => {
  test("captures a throwing execution transform as an Exit defect", async () => {
    const defect = new Error("transform failed");
    const executor = EffectBoundary.makeExecutor({
      transform: () => {
        throw defect;
      },
    });

    const exit = await executor.runExit(Effect.succeed("unused"));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.some(Cause.isDieReason)).toBe(true);
    }
  });

  test("applies the execution transform lazily for every invocation", async () => {
    let transforms = 0;
    const executor = EffectBoundary.makeExecutor({
      transform: (effect) =>
        Effect.sync(() => {
          transforms += 1;
        }).pipe(Effect.andThen(effect)),
    });

    await executor.runExit(Effect.succeed(1));
    await executor.runExit(Effect.succeed(2));

    expect(transforms).toBe(2);
  });

  test("task completion cannot replace the original result", async () => {
    let completions = 0;
    const executor = EffectBoundary.makeExecutor({
      completeTask: () =>
        Effect.sync(() => {
          completions += 1;
        }),
    });
    const host = EffectBoundary.makeHost(executor);
    const succeeds = host.task({ operation: "test.success" }, () =>
      Effect.succeed("ok")
    );
    const failure = new Error("business failure");
    const fails = host.task({ operation: "test.failure" }, () =>
      Effect.fail(failure)
    );

    await expect(succeeds()).resolves.toBe("ok");
    await expect(fails()).rejects.toBe(failure);
    expect(completions).toBe(2);
  });

  test("run forwards an explicit abort signal", async () => {
    const executor = EffectBoundary.makeExecutor();
    const host = EffectBoundary.makeHost(executor);
    const controller = new AbortController();
    const result = host.run(
      { operation: "test.abort", signal: controller.signal },
      Effect.never
    );

    controller.abort();

    await expect(result).rejects.toBeDefined();
  });
});
