import { describe, expect, test } from "bun:test";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { marketingPreferencesAtom } from "../account/legal/marketing-preferences";
import { referralsAtom } from "../account/referrals/referrals";
import { reservationHistoryAtom } from "../account/reservations/reservations-list-state";
import {
  AccountReadBudget,
  accountReadAllowance,
  allowsAutomaticRefresh,
  automaticRefreshReserve,
  type ReadBudgetWindow,
  remainingReads,
  spendRead,
} from "./account-read-budget";
import { accountAtom } from "./customer-data-runtime";
import {
  makeFakeCustomerData,
  remainingAccountReads,
  settle,
} from "./testing/customer-data-test-registry";

const minute = 60_000;

const spendTimes = (times: ReadonlyArray<number>) =>
  times.reduce<ReadBudgetWindow>((window, at) => spendRead(window, at), []);

describe("remainingReads", () => {
  test("starts with the whole allowance", () => {
    expect(remainingReads([], 0)).toBe(accountReadAllowance.reads);
  });

  test("counts every read spent within the window", () => {
    const window = spendTimes([0, 1 * minute, 2 * minute]);

    expect(remainingReads(window, 3 * minute)).toBe(
      accountReadAllowance.reads - 3
    );
  });

  test("frees a read once it is 30 minutes old", () => {
    const window = spendTimes([0, 10 * minute]);

    expect(remainingReads(window, 30 * minute - 1)).toBe(
      accountReadAllowance.reads - 2
    );
    expect(remainingReads(window, 30 * minute)).toBe(
      accountReadAllowance.reads - 1
    );
  });

  test("never goes below zero", () => {
    const window = spendTimes(
      Array.from({ length: accountReadAllowance.reads + 5 }, (_, i) => i)
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

describe("AccountReadBudget", () => {
  test("counts spent reads on the clock and frees them as they age", async () => {
    const remaining = await Effect.gen(function* () {
      const budget = yield* AccountReadBudget;
      yield* budget.spend;
      yield* TestClock.adjust("10 minutes");
      yield* budget.spend;
      const afterTwo = yield* budget.remaining;
      yield* TestClock.adjust("25 minutes");
      const afterAging = yield* budget.remaining;
      return [afterTwo, afterAging];
    }).pipe(
      Effect.provide(
        Layer.mergeAll(AccountReadBudget.Default, TestClock.layer())
      ),
      Effect.runPromise
    );

    expect(remaining).toEqual([
      accountReadAllowance.reads - 2,
      accountReadAllowance.reads - 1,
    ]);
  });
});

describe("the account read allowance", () => {
  // The server's `account-read` budget in
  // apps/deskohub-workspace/features/customer-api/customer-request-budget.ts.
  test("mirrors the server's account read budget: 40 reads per 30 minutes", () => {
    expect(accountReadAllowance.reads).toBe(40);
    expect(Duration.toMinutes(accountReadAllowance.window)).toBe(30);
  });

  type Registry = ReturnType<typeof makeFakeCustomerData>["registry"];
  test.each([
    ["the account", (r: Registry) => settle(r, accountAtom), 1],
    [
      "the reservation history",
      (r: Registry) => settle(r, reservationHistoryAtom),
      1,
    ],
    [
      "marketing consent",
      (r: Registry) => settle(r, marketingPreferencesAtom),
      0,
    ],
    ["referrals", (r: Registry) => settle(r, referralsAtom), 0],
  ] as const)(
    "counts reading %s as %d account reads, as the server does",
    async (_name, read, reads) => {
      const data = makeFakeCustomerData("linked");
      const before = await remainingAccountReads(data.registry);

      await read(data.registry);

      expect(before - (await remainingAccountReads(data.registry))).toBe(reads);
    }
  );
});
