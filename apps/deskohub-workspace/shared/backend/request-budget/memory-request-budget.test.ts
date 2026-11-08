import { describe, expect, test } from "bun:test";
import { Duration, Effect } from "effect";
import {
  makeMemoryRequestBudget,
  unavailableRequestBudget,
} from "./memory-request-budget.test-utils";
import {
  RequestBudget,
  type RequestBudgetPolicy,
} from "./request-budget.service";

const policy = (key: string, limit = 2): RequestBudgetPolicy => ({
  key,
  limit,
  window: Duration.minutes(10),
});

const spendTags = (
  budget: ReturnType<typeof makeMemoryRequestBudget>,
  policies: ReadonlyArray<RequestBudgetPolicy>
) =>
  Effect.runSync(
    Effect.gen(function* () {
      const { spend } = yield* RequestBudget;
      return yield* Effect.forEach(policies, (each) =>
        spend(each).pipe(Effect.map(({ _tag }) => _tag))
      );
    }).pipe(Effect.provide(budget.layer))
  );

describe("makeMemoryRequestBudget", () => {
  test("grants a key up to its limit and records every spend", () => {
    const budget = makeMemoryRequestBudget();

    expect(
      spendTags(budget, [policy("a"), policy("a"), policy("a"), policy("b")])
    ).toEqual(["Granted", "Granted", "Exhausted", "Granted"]);
    expect(budget.spends().map(({ key }) => key)).toEqual(["a", "a", "a", "b"]);
  });

  test("refuses keys it was told to exhaust until reset", () => {
    const budget = makeMemoryRequestBudget();
    budget.exhaust((key) => key.startsWith("tight:"));

    expect(spendTags(budget, [policy("tight:1"), policy("loose:1")])).toEqual([
      "Exhausted",
      "Granted",
    ]);

    budget.reset();

    expect(budget.spends()).toEqual([]);
    expect(spendTags(budget, [policy("tight:1")])).toEqual(["Granted"]);
  });
});

describe("unavailableRequestBudget", () => {
  test("fails every spend as unavailable", () => {
    const failure = Effect.runSync(
      Effect.gen(function* () {
        const { spend } = yield* RequestBudget;
        return yield* spend(policy("a"));
      }).pipe(Effect.flip, Effect.provide(unavailableRequestBudget()))
    );

    expect(failure).toMatchObject({
      _tag: "RequestBudgetUnavailable",
      key: "a",
    });
  });
});
