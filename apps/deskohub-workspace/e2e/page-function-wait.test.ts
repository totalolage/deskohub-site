import { afterEach, expect, setSystemTime, test } from "bun:test";
import { errors } from "@playwright/test";
import { waitForPageFunction } from "./page-function-wait";
import { workspaceE2EPollIntervalMs } from "./timeouts";

afterEach(() => setSystemTime());

const wakeMs = workspaceE2EPollIntervalMs.pageFunctionWake;

/**
 * An in-page wait that times out, advancing the clock by its timeout, until
 * `timeoutsBeforeResult` slices have; it records each slice's timeout.
 */
const fakeWait = (timeoutsBeforeResult: number) => {
  const startedAt = Date.parse("2026-11-08T12:00:00.000Z");
  let now = startedAt;
  setSystemTime(new Date(now));
  const sliceTimeouts: number[] = [];
  const result = Symbol("page function result");
  const waitSlice = async (timeoutMs: number) => {
    sliceTimeouts.push(timeoutMs);
    if (sliceTimeouts.length > timeoutsBeforeResult) return result;
    now += timeoutMs;
    setSystemTime(new Date(now));
    throw new errors.TimeoutError(`Timeout ${timeoutMs}ms exceeded.`);
  };
  return {
    elapsedMs: () => now - startedAt,
    result,
    sliceTimeouts,
    startedAt,
    waitSlice,
  };
};

test("re-issues a timed-out slice until the page function passes", async () => {
  const { result, sliceTimeouts, startedAt, waitSlice } = fakeWait(2);

  expect(await waitForPageFunction(waitSlice, startedAt + 15_000)).toBe(result);
  expect(sliceTimeouts).toEqual([wakeMs, wakeMs, wakeMs]);
});

test("gives up at its deadline", async () => {
  const { elapsedMs, sliceTimeouts, startedAt, waitSlice } = fakeWait(
    Number.POSITIVE_INFINITY
  );
  const deadline = startedAt + 2 * wakeMs + wakeMs / 2;

  const failure = await waitForPageFunction(waitSlice, deadline).then(
    () => undefined,
    (cause: unknown) => cause
  );

  expect(failure).toBeInstanceOf(errors.TimeoutError);
  expect((failure as Error).message).toContain("re-issued 3 times");
  expect(sliceTimeouts).toEqual([wakeMs, wakeMs, wakeMs / 2]);
  expect(elapsedMs()).toBe(deadline - startedAt);
});

test("fails at once when a slice fails for another reason", async () => {
  const pageError = new Error("predicate threw");
  let slices = 0;

  const failure = await waitForPageFunction(async () => {
    slices += 1;
    throw pageError;
  }, Date.now() + 15_000).then(
    () => undefined,
    (cause: unknown) => cause
  );

  expect(failure).toBe(pageError);
  expect(slices).toBe(1);
});
