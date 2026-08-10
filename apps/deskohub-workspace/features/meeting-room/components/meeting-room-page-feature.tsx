"use client";

import { PostHogProvider } from "@posthog/react";
import posthog from "posthog-js";
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
  return (
    <PostHogProvider client={posthog}>
      <MeetingRoomPageFeatureContent initialEnabled={initialEnabled}>
        {children}
      </MeetingRoomPageFeatureContent>
    </PostHogProvider>
  );
}

function MeetingRoomPageFeatureContent({
  children,
  initialEnabled,
}: MeetingRoomPageFeatureProps) {
  const enabled = useFeatureFlagEnabled("meeting_room_page", initialEnabled);

  return enabled ? children : null;
}
