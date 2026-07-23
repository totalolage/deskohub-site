import { describe, expect, mock, test } from "bun:test";
import { definePostHogFeatureFlags } from "./contract";
import { createPostHogReactFeatureFlags } from "./react";

const contract = definePostHogFeatureFlags<{
  readonly meeting_room_page: {
    readonly payload: undefined;
    readonly value: boolean;
  };
  readonly room_experience: {
    readonly payload: undefined;
    readonly value: false | "control" | "treatment";
  };
}>(["meeting_room_page", "room_experience"]);

describe("createPostHogReactFeatureFlags", () => {
  test("applies and replaces the complete typed browser override map", () => {
    const overrideFeatureFlags = mock();
    const featureFlags = createPostHogReactFeatureFlags(contract);
    const client = { featureFlags: { overrideFeatureFlags } };

    featureFlags.applyFeatureFlagOverrides(client, {
      meeting_room_page: true,
      room_experience: "treatment",
    });
    featureFlags.applyFeatureFlagOverrides(client, {
      meeting_room_page: false,
    });

    expect(overrideFeatureFlags).toHaveBeenNthCalledWith(1, {
      flags: {
        meeting_room_page: true,
        room_experience: "treatment",
      },
    });
    expect(overrideFeatureFlags).toHaveBeenNthCalledWith(2, {
      flags: { meeting_room_page: false },
    });
  });

  test("clears persisted browser overrides when no map is configured", () => {
    const overrideFeatureFlags = mock();
    const featureFlags = createPostHogReactFeatureFlags(contract);

    featureFlags.applyFeatureFlagOverrides({
      featureFlags: { overrideFeatureFlags },
    });

    expect(overrideFeatureFlags).toHaveBeenCalledWith(false);
  });
});
