import { describe, expect, spyOn, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { CENSORED_LOG_VALUE } from "../logging/censorship";
import { makeWorkspaceEffectExecutor } from "./executor";

describe("Workspace Effect executor", () => {
  test("captures throwing logger lookup as an Exit defect", async () => {
    const defect = new Error("logger lookup failed");
    const executor = makeWorkspaceEffectExecutor({
      getLoggerProvider: () => {
        throw defect;
      },
      flushTelemetry: () => Effect.void,
    });

    const exit = await executor.runExit(Effect.succeed("unused"));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.some(Cause.isDieReason)).toBe(true);
    }
  });

  test("looks up the logger lazily for every invocation", async () => {
    let lookups = 0;
    const executor = makeWorkspaceEffectExecutor({
      getLoggerProvider: () => {
        lookups += 1;
        return undefined;
      },
      flushTelemetry: () => Effect.void,
    });

    await executor.runExit(Effect.succeed(1));
    await executor.runExit(Effect.succeed(2));

    expect(lookups).toBe(2);
  });

  test("provides one censored logger composition", async () => {
    const log = spyOn(console, "info").mockImplementation(() => undefined);
    const executor = makeWorkspaceEffectExecutor({
      getLoggerProvider: () => undefined,
      flushTelemetry: () => Effect.void,
    });

    try {
      await executor.runExit(Effect.logInfo("executed", { token: "private" }));

      expect(log).toHaveBeenCalledTimes(1);
      const output = log.mock.calls.flat().join(" ");
      expect(output).toContain(CENSORED_LOG_VALUE);
      expect(output).not.toContain("private");
    } finally {
      log.mockRestore();
    }
  });

  test("task flush cannot replace the original result", async () => {
    let flushes = 0;
    const executor = makeWorkspaceEffectExecutor({
      getLoggerProvider: () => undefined,
      flushTelemetry: () =>
        Effect.sync(() => {
          flushes += 1;
        }),
    });
    const failure = new Error("business failure");

    await expect(executor.runTask(Effect.succeed("ok"))).resolves.toBe("ok");
    await expect(executor.runTask(Effect.fail(failure))).rejects.toBe(failure);
    expect(flushes).toBe(2);
  });
});
