import { expect, test } from "bun:test";
import {
  unstable_NormalPriority,
  unstable_now,
  unstable_scheduleCallback,
} from "scheduler";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "./workspace-component-test-env";

test("keeps the DOM registered until queued React Scheduler work finishes across yields", async () => {
  registerWorkspaceComponentTestEnv();
  const sawWindow: boolean[] = [];
  for (let index = 0; index < 4; index += 1) {
    unstable_scheduleCallback(unstable_NormalPriority, () => {
      // Exceed the Scheduler's 5ms frame so it yields and re-posts the rest.
      const start = unstable_now();
      while (unstable_now() - start < 8) {}
      sawWindow.push("window" in globalThis);
    });
  }

  await unregisterWorkspaceComponentTestEnv();

  expect(sawWindow).toEqual([true, true, true, true]);
});
