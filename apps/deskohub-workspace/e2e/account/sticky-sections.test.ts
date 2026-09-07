import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import type { Locator, Page } from "@playwright/test";
import { workspaceE2ETimeouts } from "../timeouts";
import { selectAccountBillingKind } from "./sticky-sections";

type ReactProps = {
  readonly onChange?: () => void;
  readonly onClick?: () => void;
};

type BillingKindPredicate = () => boolean;

type FakeSelectionPage = {
  readonly callOrder: () => readonly string[];
  readonly page: Page;
  readonly predicateResultBeforeHydration: () => boolean | undefined;
  readonly queriedSelector: () => string | undefined;
  readonly releaseHydration: () => void;
  readonly selectCalls: () => readonly string[];
  readonly setReactProps: (props: ReactProps) => void;
  readonly waitTimeout: () => number | undefined;
};

const evaluatePredicate = (
  predicate: BillingKindPredicate,
  reactProps: ReactProps
): boolean =>
  Boolean(
    runInNewContext(`(${String(predicate)})()`, {
      document: {
        querySelector: () => ({ "__reactProps$sticky-test": reactProps }),
      },
    })
  );

const makeFakeSelectionPage = (): FakeSelectionPage => {
  const callOrder: string[] = [];
  const selectCalls: string[] = [];
  let hydrationRelease!: () => void;
  const hydration = new Promise<void>((resolve) => {
    hydrationRelease = resolve;
  });
  let predicateResultBeforeHydration: boolean | undefined;
  let queriedSelector: string | undefined;
  let reactProps: ReactProps = { onClick: () => undefined };
  let waitTimeout: number | undefined;

  const page = Object.assign({} as Page, {
    locator: (selector: string) => {
      queriedSelector = selector;
      return Object.assign({} as Locator, {
        selectOption: async (value: string) => {
          callOrder.push("select");
          selectCalls.push(value);
          return [value];
        },
      });
    },
    waitForFunction: async (
      pageFunction: unknown,
      _arg: unknown,
      options: { readonly timeout?: number } = {}
    ) => {
      callOrder.push("wait");
      waitTimeout = options.timeout;
      if (typeof pageFunction !== "function")
        throw new Error("the hydration predicate was not a function");
      const predicate = pageFunction as BillingKindPredicate;
      predicateResultBeforeHydration = evaluatePredicate(predicate, reactProps);
      if (predicateResultBeforeHydration) return;
      await hydration;
      if (!evaluatePredicate(predicate, reactProps))
        throw new Error("the billing change handler did not hydrate");
    },
  });

  return {
    callOrder: () => callOrder,
    page,
    predicateResultBeforeHydration: () => predicateResultBeforeHydration,
    queriedSelector: () => queriedSelector,
    releaseHydration: hydrationRelease,
    selectCalls: () => selectCalls,
    setReactProps: (nextProps) => {
      reactProps = nextProps;
    },
    waitTimeout: () => waitTimeout,
  };
};

test("waits for the exact billing onChange handler before selecting", async () => {
  const fake = makeFakeSelectionPage();
  const selection = selectAccountBillingKind(fake.page, "business");

  await Promise.resolve();
  expect(fake.predicateResultBeforeHydration()).toBe(false);
  expect(fake.selectCalls()).toEqual([]);

  fake.setReactProps({
    onChange: () => undefined,
    onClick: () => undefined,
  });
  fake.releaseHydration();
  await selection;

  expect(fake.callOrder()).toEqual(["wait", "select"]);
  expect(fake.queriedSelector()).toBe("#account-profile-billing-kind");
  expect(fake.selectCalls()).toEqual(["business"]);
  expect(fake.waitTimeout()).toBe(workspaceE2ETimeouts.browserAction);
});
