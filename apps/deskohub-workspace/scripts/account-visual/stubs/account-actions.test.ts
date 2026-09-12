import { expect, test } from "bun:test";
import {
  clearMarketingManagementAction,
  confirmMarketingManagementAction,
  saveMarketingPreferencesAction,
} from "./account-actions";

const unavailableMessage =
  "Unavailable in component renderer: backend action was not executed.";

type AccountVisualActionTracker = {
  readonly invocationCount: number;
};

const actionTracker = (
  globalThis as typeof globalThis & {
    readonly __accountVisualActionTracker?: AccountVisualActionTracker;
  }
).__accountVisualActionTracker;

if (actionTracker === undefined) {
  throw new Error("Account visual action tracker was not initialized");
}

test("legal action stubs remain unavailable and share invocation tracking", async () => {
  let expectedInvocationCount = actionTracker.invocationCount;
  const actions = [
    saveMarketingPreferencesAction,
    confirmMarketingManagementAction,
    clearMarketingManagementAction,
  ];

  for (const action of actions) {
    const result = await action();
    expectedInvocationCount += 1;

    expect(result).toEqual({ serverError: unavailableMessage });
    expect(result).not.toHaveProperty("data");
    expect(actionTracker.invocationCount).toBe(expectedInvocationCount);
  }
});
