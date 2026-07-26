import { describe, expect, spyOn, test } from "bun:test";
import { Cause, Effect } from "effect";
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
      expect(output).toContain("shape");
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
      expect(output).toContain("operation=test.cause-projection");
      expect(output).not.toContain(sentinel);
    } finally {
      log.mockRestore();
    }
  });

  test("projects runtime fail and die causes through the combined production console layer", async () => {
    const log = spyOn(console, "error").mockImplementation(() => undefined);
    const sentinel = "SYNTHETIC-RUNTIME-CAUSE-SENTINEL";
    class CustomFailure extends Error {}
    const failures = [
      sentinel,
      new CustomFailure(sentinel, {
        cause: { detail: sentinel },
      }),
      new AggregateError(
        [
          42,
          {
            _tag: "NestedFailure",
            cause: new Error(sentinel),
          },
        ],
        sentinel
      ),
    ];

    try {
      for (const failure of failures) {
        await Effect.fail(failure).pipe(
          Effect.ignoreCause({
            log: "Error",
            message: "code-owned failure",
          }),
          runWorkspaceEffect("test.cause-projection")
        );
      }
      await Effect.failCause(
        Cause.die(
          new Error(sentinel, {
            cause: {
              _tag: "NestedDefect",
              cause: sentinel,
            },
          })
        )
      ).pipe(
        Effect.ignoreCause({
          log: "Error",
          message: "code-owned defect",
        }),
        runWorkspaceEffect("test.cause-projection")
      );

      const output = JSON.stringify(log.mock.calls);
      expect(output).toContain("operation=test.cause-projection");
      expect(output).not.toContain(sentinel);
    } finally {
      log.mockRestore();
    }
  });

  test("projects benign-looking dynamic console metadata closed", async () => {
    const log = spyOn(console, "warn").mockImplementation(() => undefined);
    const sentinel = "SyntheticValidConsoleValue";

    try {
      await Effect.logWarning(sentinel, {
        category: sentinel,
        detail: sentinel,
        response: { payload: sentinel },
        visible: sentinel,
        custom: new (class {
          readonly value = sentinel;
        })(),
      }).pipe(runWorkspaceEffect("test.run"));

      const output = log.mock.calls.flat().join(" ");
      expect(output).toContain("shape");
      expect(output).toContain("operation=test.run");
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

  test("tasks normalize synchronous and asynchronous framework defects", async () => {
    const sentinel = "SYNTHETIC-FRAMEWORK-DEFECT";
    const task = defineWorkspaceTask("test.task-defect", () => {
      throw new Error(sentinel);
    });
    const asyncTask = defineWorkspaceTask("test.task-defect", () =>
      Effect.promise(() => Promise.reject(new Error(sentinel)))
    );

    await expect(task()).rejects.toMatchObject({
      _tag: "WorkspaceFrameworkFailure",
      boundary: "task",
      kind: "defect",
    });
    await expect(asyncTask()).rejects.toMatchObject({
      _tag: "WorkspaceFrameworkFailure",
      boundary: "task",
      kind: "defect",
    });
  });
});
