import { useEffect } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { announcesLiveRegions } from "./live-region-support";

/**
 * Announces each new non-empty `message` of a live region on platforms that
 * ignore `aria-live`, so a status or alert reads the same everywhere. A
 * `polite` message waits for current speech to finish; an `assertive` one
 * interrupts it. `live` is the region's own `aria-live`, so each platform
 * hears it as politely as the region declares.
 */
export function useLiveRegionAnnouncement(
  message: string | undefined,
  live: "polite" | "assertive"
) {
  useEffect(() => {
    if (message && !announcesLiveRegions(Platform.OS)) {
      AccessibilityInfo.announceForAccessibilityWithOptions(message, {
        queue: live === "polite",
      });
    }
  }, [message, live]);
}
