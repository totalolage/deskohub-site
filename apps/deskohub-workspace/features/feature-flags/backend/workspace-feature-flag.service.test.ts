import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

const isEnabled = mock(() => Effect.succeed(true));

mock.module("./node", () => ({
  nodeFeatureFlags: {
    evaluateFlags: () => Effect.die("not used"),
    isEnabled,
  },
}));

describe("WorkspaceFeatureFlagService", () => {
  test("evaluates release gates for one non-recording global subject", async () => {
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
      subject: {
        distinctId: "deskohub-workspace:global-release",
        sendFeatureFlagEvents: false,
      },
    });
  });
});
