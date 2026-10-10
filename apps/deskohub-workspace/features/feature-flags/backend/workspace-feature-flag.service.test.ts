import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

const isEnabled = mock(() => Effect.succeed(true));
const evaluateFlags = mock(() =>
  // posthog-node reports failed remote evaluations as empty snapshots.
  Effect.succeed({ getFlag: () => undefined })
);
let globalEvaluation = false;
const getGlobalWorkspaceFeatureFlagValue = mock(() =>
  Promise.resolve(globalEvaluation ? true : undefined)
);
const getGlobalWorkspaceFeatureFlagValues = mock(() =>
  Promise.resolve(
    globalEvaluation
      ? {
          calendar_sales: true,
          customer_discounts: false,
          discount_codes: true,
        }
      : undefined
  )
);
const visitorSubject = {
  distinctId: "consented-visitor",
  sendFeatureFlagEvents: true,
} as const;
const subjectModule = await import("./subject");

mock.module("./node", () => ({
  nodeFeatureFlags: {
    evaluateFlags,
    isEnabled,
  },
}));

mock.module("./feature-flag-evaluation-mode.server", () => ({
  getGlobalWorkspaceFeatureFlagValue,
  getGlobalWorkspaceFeatureFlagValues,
}));

mock.module("./subject", () => ({
  ...subjectModule,
  getCurrentPostHogFeatureFlagSubject: () => Effect.succeed(visitorSubject),
}));

describe("WorkspaceFeatureFlagService", () => {
  beforeEach(() => {
    evaluateFlags.mockClear();
    getGlobalWorkspaceFeatureFlagValue.mockClear();
    getGlobalWorkspaceFeatureFlagValues.mockClear();
    isEnabled.mockClear();
  });

  test("evaluates default flags for the current request subject", async () => {
    globalEvaluation = false;
    const { WorkspaceFeatureFlagService } = await import(
      "./workspace-feature-flag.service"
    );

    const enabled = await WorkspaceFeatureFlagService.pipe(
      Effect.flatMap((featureFlags) =>
        featureFlags.isEnabled("meeting_room_page")
      ),
      Effect.provide(WorkspaceFeatureFlagService.Default),
      Effect.runPromise
    );

    expect(enabled).toBe(true);
    expect(getGlobalWorkspaceFeatureFlagValue).toHaveBeenCalledWith(
      "meeting_room_page"
    );
    expect(isEnabled).toHaveBeenCalledWith({
      key: "meeting_room_page",
      subject: visitorSubject,
    });
  });

  test("does not read the request subject for globally evaluated flags", async () => {
    globalEvaluation = true;
    const { WorkspaceFeatureFlagService } = await import(
      "./workspace-feature-flag.service"
    );

    const enabled = await WorkspaceFeatureFlagService.pipe(
      Effect.flatMap((featureFlags) =>
        featureFlags.isEnabled("meeting_room_page")
      ),
      Effect.provide(WorkspaceFeatureFlagService.Default),
      Effect.runPromise
    );

    expect(getGlobalWorkspaceFeatureFlagValue).toHaveBeenCalledWith(
      "meeting_room_page"
    );
    expect(enabled).toBe(true);
    expect(isEnabled).not.toHaveBeenCalled();
  });

  const discountFlagKeys = [
    "calendar_sales",
    "customer_discounts",
    "discount_codes",
  ] as const;
  const readDiscountFlags = async () => {
    const { WorkspaceFeatureFlagService } = await import(
      "./workspace-feature-flag.service"
    );

    return WorkspaceFeatureFlagService.pipe(
      Effect.flatMap((featureFlags) =>
        featureFlags.evaluateFlags({ flagKeys: discountFlagKeys })
      ),
      Effect.map((snapshot) =>
        discountFlagKeys.map((key) => snapshot.getFlag(key))
      ),
      Effect.provide(WorkspaceFeatureFlagService.Default),
      Effect.runPromise
    );
  };

  test("returns constant snapshot values without remote evaluation", async () => {
    globalEvaluation = true;

    await expect(readDiscountFlags()).resolves.toEqual([true, false, true]);

    expect(getGlobalWorkspaceFeatureFlagValues).toHaveBeenCalledWith(
      discountFlagKeys
    );
    expect(evaluateFlags).not.toHaveBeenCalled();
  });

  test("evaluates request-dependent snapshots for the current request subject", async () => {
    globalEvaluation = false;

    await expect(readDiscountFlags()).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);

    expect(evaluateFlags).toHaveBeenCalledWith({
      options: { flagKeys: discountFlagKeys },
      subject: visitorSubject,
    });
  });
});
