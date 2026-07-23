import { definePostHogFeatureFlags } from "./contract";
import type { PostHogFeatureFlagOverrides } from "./contract";
import {
  createPostHogNodeFeatureFlags,
  makePostHogNodeFeatureFlagService,
} from "./node";

interface FeatureFlagDefinitions {
  readonly meeting_room_page: {
    readonly payload: undefined;
    readonly value: boolean;
  };
  readonly room_experience: {
    readonly payload: undefined;
    readonly value: false | "control" | "treatment";
  };
}

const contract = definePostHogFeatureFlags<FeatureFlagDefinitions>([
  "meeting_room_page",
  "room_experience",
]);

const overrides = {
  meeting_room_page: false,
  room_experience: "treatment",
} satisfies PostHogFeatureFlagOverrides<FeatureFlagDefinitions>;

const trueOverride = {
  meeting_room_page: true,
} satisfies PostHogFeatureFlagOverrides<FeatureFlagDefinitions>;

const invalidKeyOverride = {
  // @ts-expect-error The generated contract rejects unknown override keys.
  seasonal_menu: true,
} satisfies PostHogFeatureFlagOverrides<FeatureFlagDefinitions>;

const invalidBooleanOverride = {
  // @ts-expect-error Boolean flags reject variant values.
  meeting_room_page: "treatment",
} satisfies PostHogFeatureFlagOverrides<FeatureFlagDefinitions>;

const invalidVariantOverride = {
  // @ts-expect-error Variant flags reject unknown variant values.
  room_experience: "seasonal",
} satisfies PostHogFeatureFlagOverrides<FeatureFlagDefinitions>;

void [
  invalidBooleanOverride,
  invalidKeyOverride,
  invalidVariantOverride,
  overrides,
  trueOverride,
];

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
  featureFlagOverrides: overrides,
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
