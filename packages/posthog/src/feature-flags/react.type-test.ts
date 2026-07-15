import {
  useFeatureFlagEnabled,
  useFeatureFlagPayload,
  useFeatureFlagResult,
  useFeatureFlagVariantKey,
} from "./react";

function FeatureFlagTypeTest() {
  const enabled: boolean = useFeatureFlagEnabled("meeting_room_page", false);
  const enabledBeforeLoad: boolean | undefined =
    useFeatureFlagEnabled("meeting_room_page");
  const value: boolean | undefined =
    useFeatureFlagVariantKey("meeting_room_page");
  const payload: undefined = useFeatureFlagPayload("meeting_room_page");
  const result = useFeatureFlagResult("meeting_room_page");

  void [enabled, enabledBeforeLoad, payload, result, value];

  // @ts-expect-error The generated contract rejects unknown flag keys.
  useFeatureFlagEnabled("unknown_flag");

  return null;
}

void FeatureFlagTypeTest;
