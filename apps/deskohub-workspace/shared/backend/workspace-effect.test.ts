<<<<<<< HEAD
import { describe, expect, spyOn, test } from "bun:test";
import { Cause, Effect } from "effect";
import {
  createPostHogLoggerProvider,
  registerPostHogLoggerProvider,
} from "./logging/posthog-otel";
import { defineWorkspaceTask, runWorkspaceEffect } from "./workspace-effect";
import type { WorkspaceOperation } from "./workspace-operation";
=======
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { LoggerProvider } from "@opentelemetry/sdk-logs";
import { Effect } from "effect";
import { notFound, redirect } from "next/navigation";
import { CENSORED_LOG_VALUE } from "./logging/censorship";
import { registerPostHogLoggerProvider } from "./logging/posthog-otel";

let scheduleAfter = (task: () => Promise<void>) => {
  scheduledTasks.push(task);
};
let scheduledTasks: Array<() => Promise<void>> = [];

mock.module("next/server", () => ({
  after: (task: () => Promise<void>) => scheduleAfter(task),
}));

registerPostHogLoggerProvider(undefined);

const {
  defineWorkspaceTask,
  runWorkspaceEffect,
  scheduleWorkspaceTelemetryFlush,
} = await import("./workspace-effect");

afterEach(() => {
  registerPostHogLoggerProvider(undefined);
  scheduledTasks = [];
  scheduleAfter = (task) => {
    scheduledTasks.push(task);
  };
});
>>>>>>> 71b705cb2396074a4a58813c2ab71fc15f9514df

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

  test("tasks flush telemetry exactly once on every exit", async () => {
    const forceFlush = mock(() => Promise.resolve());
    registerPostHogLoggerProvider({
      forceFlush,
    } as unknown as LoggerProvider);

    const success = defineWorkspaceTask("test.task-success", () =>
      Effect.succeed("done")
    );
    const failure = new Error("expected failure");
    const fail = defineWorkspaceTask("test.task-failure", () =>
      Effect.fail(failure)
    );
    const defect = new Error("unexpected defect");
    const die = defineWorkspaceTask("test.task-defect", () =>
      Effect.die(defect)
    );
    const interrupt = defineWorkspaceTask(
      "test.task-interruption",
      () => Effect.interrupt
    );

    await expect(success()).resolves.toBe("done");
    expect(forceFlush).toHaveBeenCalledTimes(1);
    await expect(fail()).rejects.toBe(failure);
    expect(forceFlush).toHaveBeenCalledTimes(2);
    await expect(die()).rejects.toBe(defect);
    expect(forceFlush).toHaveBeenCalledTimes(3);
    await expect(interrupt()).rejects.toBeDefined();
    expect(forceFlush).toHaveBeenCalledTimes(4);
  });

  test("registers telemetry before invocation and flushes after the response", async () => {
    const events: string[] = [];
    const forceFlush = mock(() => {
      events.push("flush");
      return Promise.resolve();
    });
    registerPostHogLoggerProvider({
      forceFlush,
    } as unknown as LoggerProvider);
    scheduleAfter = (task) => {
      events.push("registered");
      scheduledTasks.push(task);
    };

    await Effect.sync(() => {
      events.push("invoked");
    }).pipe(
      runWorkspaceEffect("test.action-telemetry", {
        boundary: "action",
      })
    );

    expect(events).toEqual(["registered", "invoked"]);
    expect(scheduledTasks).toHaveLength(1);
    await scheduledTasks[0]?.();
    expect(events).toEqual(["registered", "invoked", "flush"]);
    expect(forceFlush).toHaveBeenCalledTimes(1);
  });

  test("schedules post-response telemetry only for request boundaries", async () => {
    registerPostHogLoggerProvider({
      forceFlush: () => Promise.resolve(),
    } as unknown as LoggerProvider);

    await Effect.void.pipe(
      runWorkspaceEffect("test.action-boundary", { boundary: "action" })
    );
    await Effect.void.pipe(
      runWorkspaceEffect("test.route-boundary", { boundary: "route" })
    );
    await Effect.void.pipe(
      runWorkspaceEffect("test.run-boundary", { boundary: "run" })
    );
    await Effect.void.pipe(
      runWorkspaceEffect("test.task-boundary", { boundary: "task" })
    );

    expect(scheduledTasks).toHaveLength(2);
  });

  test("does not schedule telemetry without a registered provider", async () => {
    await scheduleWorkspaceTelemetryFlush().pipe(Effect.runPromise);

    expect(scheduledTasks).toHaveLength(0);
  });

  test("does not fail the invocation when telemetry scheduling fails", async () => {
    const schedulingFailure = new Error("scheduling failed");
    registerPostHogLoggerProvider({
      forceFlush: () => Promise.resolve(),
    } as unknown as LoggerProvider);
    scheduleAfter = () => {
      throw schedulingFailure;
    };

    await expect(
      Effect.andThen(
        scheduleWorkspaceTelemetryFlush(),
        Effect.succeed("ready")
      ).pipe(Effect.runPromise)
    ).resolves.toBe("ready");
    expect(scheduledTasks).toHaveLength(0);
  });

  test("preserves Next redirect and not-found control flow", async () => {
    await expect(
      Effect.sync(() => redirect("/target")).pipe(
        runWorkspaceEffect("test.redirect")
      )
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    await expect(
      Effect.sync(() => notFound()).pipe(runWorkspaceEffect("test.not-found"))
    ).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });
});
