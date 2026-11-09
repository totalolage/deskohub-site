import { expect, test } from "bun:test";
import {
  runWorkspacePlaywrightSuites,
  runWorkspacePlaywrightWithFailureCleanup,
  workspacePlaywrightProcessEnvironment,
} from "./playwright-runner";

const runContextRecorded = async () => true;

test("gives the concurrent checkout and instant navigation processes separate transform caches", () => {
  const environment = { WORKSPACE_E2E_RUN_CONTEXT: "{}" };
  const checkout = workspacePlaywrightProcessEnvironment({
    config: "playwright.e2e.config.ts",
    environment,
  });
  const instantNavigation = workspacePlaywrightProcessEnvironment({
    config: "playwright.instant-navigation.config.ts",
    environment,
  });

  expect(checkout).toMatchObject(environment);
  expect(instantNavigation).toMatchObject(environment);
  expect(checkout.PWTEST_CACHE_DIR).toBeString();
  expect(instantNavigation.PWTEST_CACHE_DIR).toBeString();
  expect(checkout.PWTEST_CACHE_DIR).not.toBe(
    instantNavigation.PWTEST_CACHE_DIR
  );
});

test("runs the cleanup-only project after a failed suite and preserves its exit", async () => {
  const invocations: string[] = [];
  const result = await runWorkspacePlaywrightWithFailureCleanup(
    async (invocation) => {
      invocations.push(invocation);
      return invocation === "suite" ? 1 : 0;
    },
    runContextRecorded
  );

  expect(invocations).toEqual(["suite", "failure-cleanup"]);
  expect(result).toEqual({ suiteExitCode: 1, cleanupExitCode: 0 });
});

test("does not rerun cleanup after a successful suite", async () => {
  const invocations: string[] = [];
  const result = await runWorkspacePlaywrightWithFailureCleanup(
    async (invocation) => {
      invocations.push(invocation);
      return 0;
    },
    runContextRecorded
  );

  expect(invocations).toEqual(["suite"]);
  expect(result).toEqual({ suiteExitCode: 0 });
});

test("reports a failed cleanup-only project without losing the suite failure", async () => {
  const invocations: string[] = [];
  const result = await runWorkspacePlaywrightWithFailureCleanup(
    async (invocation) => {
      invocations.push(invocation);
      return 1;
    },
    runContextRecorded
  );

  expect(invocations).toEqual(["suite", "failure-cleanup"]);
  expect(result).toEqual({ suiteExitCode: 1, cleanupExitCode: 1 });
});

test("keeps the suite failure when the cleanup process cannot start", async () => {
  const invocations: string[] = [];
  const result = await runWorkspacePlaywrightWithFailureCleanup(
    async (invocation) => {
      invocations.push(invocation);
      if (invocation === "suite") return 1;
      throw new Error("private process error");
    },
    runContextRecorded
  );

  expect(invocations).toEqual(["suite", "failure-cleanup"]);
  expect(result).toEqual({
    suiteExitCode: 1,
    cleanupCouldNotStart: true,
  });
});

test("skips the cleanup-only project when the failed suite never recorded a run context", async () => {
  const invocations: string[] = [];
  const result = await runWorkspacePlaywrightWithFailureCleanup(
    async (invocation) => {
      invocations.push(invocation);
      return 1;
    },
    async () => false
  );

  expect(invocations).toEqual(["suite"]);
  expect(result).toEqual({
    suiteExitCode: 1,
    cleanupSkippedWithoutRunContext: true,
  });
});

// One macrotask turn runs every queued microtask, so a runner that does not
// wait for its pending runs has settled by the time this resolves.
const drainMicrotasks = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

const trackSettlement = (promise: Promise<unknown>) => {
  const state = { settled: false };
  void promise.finally(() => {
    state.settled = true;
  });
  return state;
};

test("waits for the failed checkout and its cleanup when instant navigation cannot launch", async () => {
  const events: string[] = [];
  const launchFailure = new Error("private process error");
  const exits = {
    suite: Promise.withResolvers<number>(),
    "failure-cleanup": Promise.withResolvers<number>(),
  };
  const running = runWorkspacePlaywrightSuites({
    checkout: async (invocation) => {
      events.push(`${invocation}:start`);
      const exitCode = await exits[invocation].promise;
      events.push(`${invocation}:end`);
      return exitCode;
    },
    hasCheckoutRunContext: runContextRecorded,
    instantNavigation: () => {
      events.push("instant-navigation:launch");
      throw launchFailure;
    },
  });
  const runner = trackSettlement(running);

  await drainMicrotasks();
  expect(events).toEqual(["suite:start", "instant-navigation:launch"]);
  expect(runner.settled).toBe(false);

  exits.suite.resolve(1);
  await drainMicrotasks();
  expect(events.at(-1)).toBe("failure-cleanup:start");
  expect(runner.settled).toBe(false);

  exits["failure-cleanup"].resolve(0);
  const result = await running;

  expect(events).toEqual([
    "suite:start",
    "instant-navigation:launch",
    "suite:end",
    "failure-cleanup:start",
    "failure-cleanup:end",
  ]);
  expect(result).toEqual({
    checkout: {
      status: "fulfilled",
      value: { suiteExitCode: 1, cleanupExitCode: 0 },
    },
    instantNavigation: { status: "rejected", reason: launchFailure },
  });
});

test("waits for instant navigation when the checkout run cannot launch", async () => {
  const launchFailure = new Error("private process error");
  const instantNavigationExit = Promise.withResolvers<number>();
  const running = runWorkspacePlaywrightSuites({
    checkout: () => {
      throw launchFailure;
    },
    hasCheckoutRunContext: runContextRecorded,
    instantNavigation: () => instantNavigationExit.promise,
  });
  const runner = trackSettlement(running);

  await drainMicrotasks();
  expect(runner.settled).toBe(false);

  instantNavigationExit.resolve(0);

  expect(await running).toEqual({
    checkout: { status: "rejected", reason: launchFailure },
    instantNavigation: { status: "fulfilled", value: 0 },
  });
});
