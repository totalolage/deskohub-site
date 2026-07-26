import { describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import * as NextServer from "next/server";
import { WorkspaceLoggerLive } from "./logging/censorship";
import { PostResponseTaskService } from "./post-response-task.service";
import type { WorkspaceOperation } from "./workspace-operation";

describe("PostResponseTaskService", () => {
  test("rejects an unknown operation before scheduling", async () => {
    const schedule = spyOn(NextServer, "after").mockImplementation(
      () => undefined
    );
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const unknownOperation = "SENSITIVE-POST-RESPONSE-OPERATION";
    let taskExecuted = false;

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const tasks = yield* PostResponseTaskService;
          yield* tasks.run({
            operation: unknownOperation as WorkspaceOperation,
            task: Effect.sync(() => {
              taskExecuted = true;
            }),
          });
        }).pipe(
          Effect.provide(PostResponseTaskService.Live),
          Effect.provide(WorkspaceLoggerLive)
        )
      );

      const output = JSON.stringify(warn.mock.calls);
      expect(schedule).not.toHaveBeenCalled();
      expect(taskExecuted).toBe(false);
      expect(output).toContain("operation=operation");
      expect(output).not.toContain(unknownOperation);
    } finally {
      warn.mockRestore();
      schedule.mockRestore();
    }
  });
});
