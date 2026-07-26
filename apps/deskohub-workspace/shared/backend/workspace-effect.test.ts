import { describe, expect, spyOn, test } from "bun:test";
import { Cause, Effect } from "effect";
import {
  createPostHogLoggerProvider,
  registerPostHogLoggerProvider,
} from "./logging/posthog-otel";
import { defineWorkspaceTask, runWorkspaceEffect } from "./workspace-effect";
import type { WorkspaceOperation } from "./workspace-operation";

describe("Workspace Effect execution", () => {
  test("provides the censored Workspace logger", async () => {
    const log = spyOn(console, "info").mockImplementation(() => undefined);

    try {
      await Effect.logInfo("executed", { token: "private" }).pipe(
        runWorkspaceEffect("gallery.images.load")
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
      }).pipe(runWorkspaceEffect("checkout.pay.load"));

      const output = log.mock.calls.flat().join(" ");
      expect(output).toContain("operation=checkout.pay.load");
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
          runWorkspaceEffect("checkout.pay.load")
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
        runWorkspaceEffect("checkout.pay.load")
      );

      const output = JSON.stringify(log.mock.calls);
      expect(output).toContain("operation=checkout.pay.load");
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
      }).pipe(runWorkspaceEffect("gallery.images.load"));

      const output = log.mock.calls.flat().join(" ");
      expect(output).toContain("shape");
      expect(output).toContain("operation=gallery.images.load");
      expect(output).not.toContain(sentinel);
    } finally {
      log.mockRestore();
    }
  });

  test("rejects unknown operations through task, console, and OTLP runtime paths", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        requests.push(await request.text());
        return new Response(null, { status: 200 });
      },
    });
    const provider = createPostHogLoggerProvider({
      posthogHost: server.url.toString(),
      posthogProjectToken: crypto.randomUUID(),
      vercelEnv: "development",
    });
    if (!provider) throw new Error("Expected a synthetic logger provider.");
    const log = spyOn(console, "error").mockImplementation(() => undefined);
    const unknownOperation = "SENSITIVE-UNKNOWN-OPERATION-IDENTIFIER";
    let effectExecuted = false;
    let taskExecuted = false;

    registerPostHogLoggerProvider(provider);
    try {
      await expect(
        Effect.sync(() => {
          effectExecuted = true;
        }).pipe(runWorkspaceEffect(unknownOperation as WorkspaceOperation))
      ).rejects.toMatchObject({ _tag: "InvalidWorkspaceOperation" });

      const task = defineWorkspaceTask(
        unknownOperation as WorkspaceOperation,
        () =>
          Effect.sync(() => {
            taskExecuted = true;
          })
      );
      await expect(task()).rejects.toMatchObject({
        _tag: "InvalidWorkspaceOperation",
      });
      await provider.forceFlush();

      const consoleOutput = JSON.stringify(log.mock.calls);
      const otlpOutput = requests.join("");

      expect(effectExecuted).toBe(false);
      expect(taskExecuted).toBe(false);
      expect(consoleOutput).toContain("operation=operation");
      expect(otlpOutput).toContain('"key":"operation"');
      expect(otlpOutput).toContain('"stringValue":"operation"');
      expect(otlpOutput).toContain('"stringValue":"run"');
      expect(otlpOutput).toContain('"stringValue":"task"');
      expect(consoleOutput).not.toContain(unknownOperation);
      expect(otlpOutput).not.toContain(unknownOperation);
    } finally {
      registerPostHogLoggerProvider(undefined);
      log.mockRestore();
      await provider.shutdown();
      server.stop(true);
    }
  });

  test("tasks preserve success and failure results", async () => {
    const succeeds = defineWorkspaceTask("reservationHoldCleanupSchedule", () =>
      Effect.succeed("done")
    );
    const failure = new Error("retry");
    const fails = defineWorkspaceTask("reservationHoldCleanupSchedule", () =>
      Effect.fail(failure)
    );

    await expect(succeeds()).resolves.toBe("done");
    await expect(fails()).rejects.toBe(failure);
  });

  test("tasks normalize synchronous and asynchronous framework defects", async () => {
    const sentinel = "SYNTHETIC-FRAMEWORK-DEFECT";
    const task = defineWorkspaceTask("reservationHoldCleanupSchedule", () => {
      throw new Error(sentinel);
    });
    const asyncTask = defineWorkspaceTask(
      "reservationHoldCleanupSchedule",
      () => Effect.promise(() => Promise.reject(new Error(sentinel)))
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
