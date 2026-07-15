import { definePostHogFeatureFlags } from "./contract";
import { createPostHogNodeFeatureFlags } from "./node";

const contract = definePostHogFeatureFlags<{
  readonly meeting_room_page: {
    readonly payload: undefined;
    readonly value: boolean;
  };
}>(["meeting_room_page"]);

const featureFlags = createPostHogNodeFeatureFlags(contract, {
  evaluateFlags: () =>
    Promise.resolve({
      getFlag: () => true,
      getFlagPayload: () => undefined,
      isEnabled: () => true,
    }),
});

const program = featureFlags.evaluateFlags("public-site", {
  flagKeys: ["meeting_room_page"],
});

// @ts-expect-error The generated contract rejects unknown flag keys.
featureFlags.evaluateFlags("public-site", { flagKeys: ["seasonal_menu"] });

void program;
