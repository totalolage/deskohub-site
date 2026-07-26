import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { LoggerProvider } from "@opentelemetry/sdk-logs";
import { Effect } from "effect";
import { notFound, redirect } from "next/navigation";
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

describe("Workspace Effect execution", () => {
  test("provides the censored Workspace logger", async () => {
    const log = spyOn(console, "info").mockImplementation(() => undefined);

    try {
      await Effect.logInfo("executed", { token: "private" }).pipe(
        runWorkspaceEffect("test.run")
      );

      expect(log).toHaveBeenCalledTimes(1);
      const output = log.mock.calls.flat().join(" ");
      expect(output).toContain('\\"shape\\":\\"array\\"');
      expect(output).not.toContain("private");
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
