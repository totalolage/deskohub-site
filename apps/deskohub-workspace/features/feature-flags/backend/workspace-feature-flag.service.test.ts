import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

const isEnabled = mock(() => Effect.succeed(true));
let globalEvaluation = false;
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
}));

mock.module("./subject", () => ({
  ...subjectModule,
  getCurrentPostHogFeatureFlagSubject: () => Effect.succeed(visitorSubject),
}));

describe("WorkspaceFeatureFlagService", () => {
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

    await WorkspaceFeatureFlagService.pipe(
      Effect.flatMap((featureFlags) =>
        featureFlags.isEnabled("meeting_room_page")
      ),
      Effect.provide(WorkspaceFeatureFlagService.Default),
      Effect.runPromise
    );

    expect(isEnabled).toHaveBeenLastCalledWith({
      key: "meeting_room_page",
      subject: {
        distinctId: "deskohub-workspace:global-release",
        sendFeatureFlagEvents: false,
      },
    });
  });

  test("evaluates global release flags for one non-recording subject", async () => {
    const { WorkspaceFeatureFlagService } = await import(
      "./workspace-feature-flag.service"
    );

    const enabled = await WorkspaceFeatureFlagService.pipe(
      Effect.flatMap((featureFlags) =>
        featureFlags.isEnabled("meeting_room_page")
      ),
      Effect.provide(WorkspaceFeatureFlagService.GlobalRelease),
      Effect.runPromise
    );

    expect(enabled).toBe(true);
    expect(isEnabled).toHaveBeenCalledWith({
      key: "meeting_room_page",
      subject: {
        distinctId: "deskohub-workspace:global-release",
        sendFeatureFlagEvents: false,
      },
    });
  });
});
