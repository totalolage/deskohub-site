import { expect, test } from "bun:test";
import {
  clearMarketingManagementAction,
  confirmMarketingManagementAction,
  removeCustomerAvatar,
  saveMarketingPreferencesAction,
  uploadCustomerAvatar,
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

type AccountVisualAvatarOutcome =
  | "pending-upload"
  | "pending-remove"
  | "uploaded"
  | "removed"
  | "retryable-upload"
  | "unavailable";

const setAvatarOutcome = (outcome: AccountVisualAvatarOutcome | undefined) => {
  const scope = globalThis as typeof globalThis & {
    __accountVisualAvatarOutcome?: AccountVisualAvatarOutcome;
  };
  scope.__accountVisualAvatarOutcome = outcome;
};

test("avatar stub fallback counts exactly one invocation per call", async () => {
  setAvatarOutcome(undefined);
  let expectedInvocationCount = actionTracker.invocationCount;
  for (const action of [uploadCustomerAvatar, removeCustomerAvatar]) {
    const result = await action();
    expectedInvocationCount += 1;

    expect(result).toEqual({ serverError: unavailableMessage });
    expect(result).not.toHaveProperty("data");
    expect(actionTracker.invocationCount).toBe(expectedInvocationCount);
  }
});

test("avatar stubs count one invocation and hold or resolve per outcome", async () => {
  const outcomes: readonly {
    readonly outcome: AccountVisualAvatarOutcome;
    readonly expectedStatus?: string;
  }[] = [
    { outcome: "pending-upload" },
    { outcome: "uploaded", expectedStatus: "uploaded" },
    { outcome: "pending-remove" },
    { outcome: "removed", expectedStatus: "removed" },
    { outcome: "retryable-upload", expectedStatus: "retryable" },
  ];
  let expectedInvocationCount = actionTracker.invocationCount;
  for (const { outcome, expectedStatus } of outcomes) {
    setAvatarOutcome(outcome);
    const action = outcome.includes("upload")
      ? uploadCustomerAvatar
      : removeCustomerAvatar;
    const resultPromise = action();
    expectedInvocationCount += 1;

    if (outcome.startsWith("pending-")) {
      // The stub intentionally never settles so the pending state holds.
      // Race against a bounded window so this fails if a pending branch is
      // ever changed to resolve or reject (e.g. Promise.resolve).
      const settlement = await Promise.race([
        resultPromise.then(
          () => "settled" as const,
          () => "settled" as const
        ),
        new Promise<"still-pending">((resolvePending) => {
          setTimeout(() => resolvePending("still-pending"), 25);
        }),
      ]);
      expect(settlement).toBe("still-pending");
    } else {
      expect(await resultPromise).toEqual({
        data: expect.objectContaining({ status: expectedStatus }),
      });
    }
    expect(actionTracker.invocationCount).toBe(expectedInvocationCount);
  }
  setAvatarOutcome(undefined);
});
