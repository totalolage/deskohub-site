import { definePostHogFeatureFlags } from "./contract";
import {
  createPostHogNodeFeatureFlags,
  makePostHogNodeFeatureFlagService,
} from "./node";

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
void featureFlags.evaluateFlags("public-site", { flagKeys: ["seasonal_menu"] });

void program;

const service = makePostHogNodeFeatureFlagService(contract, {
  clientOptions: {
    flushAt: 1,
    host: "https://posthog.example",
  },
  defaultEvaluationOptions: { disableGeoip: true },
  projectToken: "phc_test",
});

const subject = {
  distinctId: "visitor-id",
  sendFeatureFlagEvents: true,
} as const;

void service.isEnabled({ key: "meeting_room_page", subject });
void service.evaluateFlags({
  options: { flagKeys: ["meeting_room_page"] },
  subject,
});

// @ts-expect-error The generated contract rejects unknown flag keys.
void service.isEnabled({ key: "seasonal_menu", subject });

void service.evaluateFlags({
  options: {
    // @ts-expect-error The generated contract rejects unknown flag keys.
    flagKeys: ["seasonal_menu"],
  },
  subject,
});
