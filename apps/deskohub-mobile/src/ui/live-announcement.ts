import { useEffect } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { announcesLiveRegions } from "./live-region-support";

/**
 * Announces each new non-empty `message` of a live region on platforms that
 * ignore `aria-live`, so a status or alert reads the same everywhere.
 */
export function useLiveRegionAnnouncement(message: string | undefined) {
  useEffect(() => {
    if (message && !announcesLiveRegions(Platform.OS)) {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message]);
}
