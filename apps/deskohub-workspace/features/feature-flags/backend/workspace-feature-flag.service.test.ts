import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Option, Result } from "effect";
import type { WorkspaceFeatureFlagConstancy } from "./feature-flag-evaluation-mode.server";

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
let constancy: WorkspaceFeatureFlagConstancy = { kind: "per-request" };
const getWorkspaceFeatureFlagConstancy = mock(() => Promise.resolve(constancy));
const visitorSubject = {
  distinctId: "consented-visitor",
  sendFeatureFlagEvents: true,
} as const;
const subjectModule = await import("./subject");

mock.module("./node", () => ({
  nodeFeatureFlags: {
    evaluateFlags,
  },
}));

mock.module("./feature-flag-evaluation-mode.server", () => ({
  getGlobalWorkspaceFeatureFlagValue,
  getGlobalWorkspaceFeatureFlagValues,
  getWorkspaceFeatureFlagConstancy,
}));

const getCurrentFeatureFlagAudience = mock(() =>
  Effect.succeed({ subject: visitorSubject, request: undefined })
);
mock.module("./subject", () => ({
  ...subjectModule,
  getCurrentFeatureFlagAudience,
}));

describe("WorkspaceFeatureFlagService", () => {
  beforeEach(() => {
    evaluateFlags.mockClear();
    getGlobalWorkspaceFeatureFlagValue.mockClear();
    getGlobalWorkspaceFeatureFlagValues.mockClear();
    getCurrentFeatureFlagAudience.mockClear();
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
    expect(evaluateFlags).not.toHaveBeenCalled();
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

  const readFlag = async <A, E>(
    read: (
      featureFlags: import("./workspace-feature-flag.service").IWorkspaceFeatureFlagService
    ) => Effect.Effect<A, E>
  ) => {
    const { WorkspaceFeatureFlagService } = await import(
      "./workspace-feature-flag.service"
    );
    return WorkspaceFeatureFlagService.pipe(
      Effect.flatMap(read),
      Effect.provide(WorkspaceFeatureFlagService.Default),
      Effect.result,
      Effect.runPromise
    );
  };

  describe("decision, for output that can be stored", () => {
    test("answers a constant without reading the request", async () => {
      constancy = { kind: "constant", value: false };

      expect(
        await readFlag((flags) => flags.decision("meeting_room_page"))
      ).toEqual(Result.succeed(false));
      expect(getCurrentFeatureFlagAudience).not.toHaveBeenCalled();
      expect(evaluateFlags).not.toHaveBeenCalled();
    });

    test("fails without reading the request while no classification could be read", async () => {
      constancy = { kind: "unclassified" };

      const decision = await readFlag((flags) =>
        flags.decision("meeting_room_page")
      );

      expect(Result.isFailure(decision)).toBe(true);
      expect(getCurrentFeatureFlagAudience).not.toHaveBeenCalled();
      expect(evaluateFlags).not.toHaveBeenCalled();
    });

    test("reads the request for a flag decided per visitor", async () => {
      constancy = { kind: "per-request" };
      globalEvaluation = false;

      // Outside production the flag stays closed without asking PostHog.
      expect(
        await readFlag((flags) => flags.decision("meeting_room_page"))
      ).toEqual(Result.succeed(false));
      expect(getCurrentFeatureFlagAudience).toHaveBeenCalled();
    });
  });

  test("constantValue answers a constant, none per visitor, and fails while no classification could be read", async () => {
    const constantValue = () =>
      readFlag((flags) => flags.constantValue("meeting_room_page"));

    constancy = { kind: "constant", value: true };
    expect(await constantValue()).toEqual(Result.succeed(Option.some(true)));
    constancy = { kind: "per-request" };
    expect(await constantValue()).toEqual(Result.succeed(Option.none()));
    constancy = { kind: "unclassified" };
    expect(Result.isFailure(await constantValue())).toBe(true);
    expect(getCurrentFeatureFlagAudience).not.toHaveBeenCalled();
  });
});
