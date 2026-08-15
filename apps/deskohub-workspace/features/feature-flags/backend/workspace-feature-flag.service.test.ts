import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

const isEnabled = mock(() => Effect.succeed(true));
let globalEvaluation = false;
const getGlobalWorkspaceFeatureFlagValue = mock(() =>
  Promise.resolve(globalEvaluation ? true : undefined)
);
const visitorSubject = {
  distinctId: "consented-visitor",
  sendFeatureFlagEvents: true,
} as const;
const subjectModule = await import("./subject");

mock.module("./node", () => ({
  nodeFeatureFlags: {
    evaluateFlags: () => Effect.die("not used"),
    isEnabled,
  },
}));

mock.module("./feature-flag-evaluation-mode.server", () => ({
  areWorkspaceFeatureFlagsGlobal: () => Promise.resolve(globalEvaluation),
  getGlobalWorkspaceFeatureFlagValue,
}));

mock.module("./subject", () => ({
  ...subjectModule,
  getCurrentPostHogFeatureFlagSubject: () => Effect.succeed(visitorSubject),
}));

describe("WorkspaceFeatureFlagService", () => {
  beforeEach(() => {
    getGlobalWorkspaceFeatureFlagValue.mockClear();
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
});
