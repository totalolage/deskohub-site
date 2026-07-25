import { describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { CENSORED_LOG_VALUE } from "./logging/censorship";
import { defineWorkspaceTask, runWorkspaceEffect } from "./workspace-effect";

describe("Workspace Effect execution", () => {
  test("provides the censored Workspace logger", async () => {
    const log = spyOn(console, "info").mockImplementation(() => undefined);

    try {
      await Effect.logInfo("executed", { token: "private" }).pipe(
        runWorkspaceEffect("test.run")
      );

      expect(log).toHaveBeenCalledTimes(1);
      const output = log.mock.calls.flat().join(" ");
      expect(output).toContain(CENSORED_LOG_VALUE);
      expect(output).not.toContain("private");
    } finally {
      log.mockRestore();
    }
  });

  test("projects arbitrary nested causes before console output", async () => {
    const log = spyOn(console, "error").mockImplementation(() => undefined);
    const sentinel = "SENSITIVE-CATEGORY-SENTINEL";

    try {
      await Effect.logError("code-owned log message", {
        cause: new AggregateError(
          [
            sentinel,
            42,
            {
              _tag: "SyntheticTaggedCause",
              customerId: sentinel,
              cause: new Error(sentinel),
            },
          ],
          sentinel
        ),
        providerOrderId: sentinel,
      }).pipe(runWorkspaceEffect("test.cause-projection"));

      const output = log.mock.calls.flat().join(" ");
      expect(output).toContain("aggregate_error");
      expect(output).not.toContain(sentinel);
    } finally {
      log.mockRestore();
    }
  });

  test("tasks preserve success and failure results", async () => {
    const succeeds = defineWorkspaceTask("test.task", () =>
      Effect.succeed("done")
    );
    const failure = new Error("retry");
    const fails = defineWorkspaceTask("test.task-failure", () =>
      Effect.fail(failure)
    );

    await expect(succeeds()).resolves.toBe("done");
    await expect(fails()).rejects.toBe(failure);
  });

  test("tasks suspend synchronous handler construction", async () => {
    const defect = new Error("construction failed");
    const task = defineWorkspaceTask("test.task-defect", () => {
      throw defect;
    });

    await expect(task()).rejects.toBe(defect);
  });
});
