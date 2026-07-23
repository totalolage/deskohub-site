import { definePostHogFeatureFlags } from "./contract";
import { createPostHogReactFeatureFlags } from "./react";

const workspaceContract = definePostHogFeatureFlags<{
  readonly meeting_room_page: {
    readonly payload: undefined;
    readonly value: boolean;
  };
}>(["meeting_room_page"]);

const barContract = definePostHogFeatureFlags<{
  readonly seasonal_menu: {
    readonly payload: { readonly menuId: number } | undefined;
    readonly value: false | "control" | "summer";
  };
}>(["seasonal_menu"]);

const workspaceFlags = createPostHogReactFeatureFlags(workspaceContract);
const barFlags = createPostHogReactFeatureFlags(barContract);

const postHogFeatureFlags = {
  overrideFeatureFlags: (
    _overrides:
      | false
      | {
          readonly flags: Readonly<Record<string, boolean | string>>;
        }
  ) => {},
};

workspaceFlags.applyFeatureFlagOverrides({ featureFlags: postHogFeatureFlags }, {
  meeting_room_page: false,
});
barFlags.applyFeatureFlagOverrides(
  { featureFlags: postHogFeatureFlags },
  { seasonal_menu: "summer" }
);

workspaceFlags.applyFeatureFlagOverrides(
  { featureFlags: postHogFeatureFlags },
  // @ts-expect-error Workspace cannot override a Bar feature flag.
  { seasonal_menu: true }
);
workspaceFlags.applyFeatureFlagOverrides(
  { featureFlags: postHogFeatureFlags },
  // @ts-expect-error Boolean flags reject variant values.
  { meeting_room_page: "summer" }
);
barFlags.applyFeatureFlagOverrides(
  { featureFlags: postHogFeatureFlags },
  // @ts-expect-error Variant flags reject unknown variants.
  { seasonal_menu: "winter" }
);

function FeatureFlagTypeTest() {
  const enabled: boolean = workspaceFlags.useFeatureFlagEnabled(
    "meeting_room_page",
    false
  );
  const enabledBeforeLoad: boolean | undefined =
    workspaceFlags.useFeatureFlagEnabled("meeting_room_page");
  const value: false | "control" | "summer" | undefined =
    barFlags.useFeatureFlagVariantKey("seasonal_menu");
  const payload: { readonly menuId: number } | undefined =
    barFlags.useFeatureFlagPayload("seasonal_menu");

  void [enabled, enabledBeforeLoad, payload, value];

  // @ts-expect-error Workspace cannot consume a Bar feature flag.
  workspaceFlags.useFeatureFlagEnabled("seasonal_menu");

  // @ts-expect-error Bar cannot consume a Workspace feature flag.
  barFlags.useFeatureFlagEnabled("meeting_room_page");

  return null;
}

void FeatureFlagTypeTest;
