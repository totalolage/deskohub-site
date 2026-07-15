"use client";

import { useFeatureFlagEnabled } from "@deskohub/posthog/feature-flags/react";
import type { ReactNode } from "react";

type MeetingRoomPageFeatureProps = {
  children: ReactNode;
  initialEnabled: boolean;
};

export function MeetingRoomPageFeature({
  children,
  initialEnabled,
}: MeetingRoomPageFeatureProps) {
  const enabled = useFeatureFlagEnabled("meeting_room_page", initialEnabled);

  return enabled ? children : null;
}
