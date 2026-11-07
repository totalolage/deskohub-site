import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  allowsAutomaticRefresh,
  automaticRefreshReserve,
  DotyposReadBudget,
  dotyposReadAllowance,
  type ReadBudgetWindow,
  remainingReads,
  spendRead,
} from "./dotypos-read-budget";

const minute = 60_000;

const spendTimes = (times: ReadonlyArray<number>) =>
  times.reduce<ReadBudgetWindow>((window, at) => spendRead(window, at), []);

describe("remainingReads", () => {
  test("starts with the whole allowance", () => {
    expect(remainingReads([], 0)).toBe(dotyposReadAllowance.reads);
  });

  test("counts every read spent within the window", () => {
    const window = spendTimes([0, 1 * minute, 2 * minute]);

    expect(remainingReads(window, 3 * minute)).toBe(
      dotyposReadAllowance.reads - 3
    );
  });

  test("frees a read once it is 30 minutes old", () => {
    const window = spendTimes([0, 10 * minute]);

    expect(remainingReads(window, 30 * minute - 1)).toBe(
      dotyposReadAllowance.reads - 2
    );
    expect(remainingReads(window, 30 * minute)).toBe(
      dotyposReadAllowance.reads - 1
    );
  });

  test("never goes below zero", () => {
    const window = spendTimes(
      Array.from({ length: dotyposReadAllowance.reads + 5 }, (_, i) => i)
    );

    expect(remainingReads(window, 100)).toBe(0);
  });

  test("drops expired reads when spending, so the window stays bounded", () => {
    const window = spendTimes([0, 1, 2, 31 * minute]);

    expect(window).toEqual([31 * minute]);
  });
});

describe("allowsAutomaticRefresh", () => {
  test("stops automatic refreshes below the reserve", () => {
    expect(allowsAutomaticRefresh(automaticRefreshReserve)).toBe(true);
    expect(allowsAutomaticRefresh(automaticRefreshReserve - 1)).toBe(false);
  });
});

describe("DotyposReadBudget", () => {
  test("counts spent reads on the clock and frees them as they age", async () => {
    const remaining = await Effect.gen(function* () {
      const budget = yield* DotyposReadBudget;
      yield* budget.spend;
      yield* TestClock.adjust("10 minutes");
      yield* budget.spend;
      const afterTwo = yield* budget.remaining;
      yield* TestClock.adjust("25 minutes");
      const afterAging = yield* budget.remaining;
      return [afterTwo, afterAging];
    }).pipe(
      Effect.provide(
        Layer.mergeAll(DotyposReadBudget.Default, TestClock.layer())
      ),
      Effect.runPromise
    );

    expect(remaining).toEqual([
      dotyposReadAllowance.reads - 2,
      dotyposReadAllowance.reads - 1,
    ]);
  });
});
