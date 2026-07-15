"use client";

import type { ReactNode } from "react";
import { useFeatureFlagEnabled } from "@/features/feature-flags/react";

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
