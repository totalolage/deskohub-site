import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { Temporal } from "@js-temporal/polyfill";
import { act } from "react";
import {
  unstable_cancelCallback,
  unstable_IdlePriority,
  unstable_scheduleCallback,
} from "scheduler";
import "@/shared/testing/workspace-test-env";

let registered = false;

export const registerWorkspaceComponentTestEnv = () => {
  if (registered) return;
  GlobalRegistrator.register();
  Object.defineProperty(globalThis, "Temporal", {
    configurable: true,
    writable: true,
    value: Temporal,
  });
  registered = true;
};

const reactSchedulerDrainTimeoutMs = 5000;

// Commits outside act queue their passive-effect flush on React's Scheduler,
// which reads `window` when it runs. An idle-priority task expires after every
// task already queued, including work the Scheduler re-posts when it yields, so
// it runs only once that work has finished.
const drainReactScheduler = () =>
  new Promise<void>((resolve, reject) => {
    const task = unstable_scheduleCallback(unstable_IdlePriority, () => {
      clearTimeout(timeout);
      resolve();
    });
    const timeout = setTimeout(() => {
      unstable_cancelCallback(task);
      reject(
        new Error(
          `React Scheduler work did not finish within ${reactSchedulerDrainTimeoutMs}ms`
        )
      );
    }, reactSchedulerDrainTimeoutMs);
  });

export const unregisterWorkspaceComponentTestEnv = async () => {
  if (!registered) return;
  await drainReactScheduler();
  GlobalRegistrator.unregister();
  registered = false;
};

export const flushWorkspaceComponentWork = async () => {
  await act(async () => {});
};
