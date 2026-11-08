import { afterEach, expect, setSystemTime, test } from "bun:test";
import { errors, type Page } from "@playwright/test";
import { waitForPageFunction } from "./page-function-wait";
import { workspaceE2EPollIntervalMs } from "./timeouts";

afterEach(() => setSystemTime());

const wakeMs = workspaceE2EPollIntervalMs.pageFunctionWake;

/**
 * A page whose in-page waits time out, advancing the clock by their timeout,
 * until `timeoutsBeforeResult` of them have; it records each wait's options.
 */
const fakePage = (timeoutsBeforeResult: number) => {
  const startedAt = Date.parse("2026-11-08T12:00:00.000Z");
  let now = startedAt;
  setSystemTime(new Date(now));
  const waits: { polling?: unknown; timeout?: number }[] = [];
  const handle = { dispose: async () => {} };
  const page = Object.assign({} as Pick<Page, "waitForFunction">, {
    waitForFunction: async (
      _pageFunction: unknown,
      _arg: unknown,
      options: { polling?: unknown; timeout?: number }
    ) => {
      waits.push(options);
      if (waits.length > timeoutsBeforeResult) return handle;
      now += options.timeout ?? 0;
      setSystemTime(new Date(now));
      throw new errors.TimeoutError(`Timeout ${options.timeout}ms exceeded.`);
    },
  });
  return { elapsedMs: () => now - startedAt, handle, page, startedAt, waits };
};

test("re-issues a timed-out in-page wait until the page function passes", async () => {
  const { handle, page, startedAt, waits } = fakePage(2);

  const result = await waitForPageFunction(page, () => true, undefined, {
    deadline: startedAt + 15_000,
    polling: 100,
  });

  expect(result).toBe(handle as never);
  expect(waits).toEqual([
    { polling: 100, timeout: wakeMs },
    { polling: 100, timeout: wakeMs },
    { polling: 100, timeout: wakeMs },
  ]);
});

test("gives up at its deadline", async () => {
  const { elapsedMs, page, startedAt, waits } = fakePage(Number.POSITIVE_INFINITY);
  const deadline = startedAt + 2 * wakeMs + wakeMs / 2;

  const failure = await waitForPageFunction(page, () => true, undefined, {
    deadline,
    polling: 100,
  }).then(
    () => undefined,
    (cause: unknown) => cause
  );

  expect(failure).toBeInstanceOf(errors.TimeoutError);
  expect((failure as Error).message).toContain("re-issued 3 times");
  expect(waits.map((wait) => wait.timeout)).toEqual([
    wakeMs,
    wakeMs,
    wakeMs / 2,
  ]);
  expect(elapsedMs()).toBe(deadline - startedAt);
});

test("fails at once when the page function throws", async () => {
  const pageError = new Error("predicate threw");
  let waits = 0;
  const page = Object.assign({} as Pick<Page, "waitForFunction">, {
    waitForFunction: async () => {
      waits += 1;
      throw pageError;
    },
  });

  const failure = await waitForPageFunction(page, () => true, undefined, {
    deadline: Date.now() + 15_000,
    polling: 100,
  }).then(
    () => undefined,
    (cause: unknown) => cause
  );

  expect(failure).toBe(pageError);
  expect(waits).toBe(1);
});
