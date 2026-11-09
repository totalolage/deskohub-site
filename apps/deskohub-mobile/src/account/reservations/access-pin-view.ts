import { useEffect } from "react";
import { trackAccessPinViewed } from "../../analytics/events";

/**
 * Records a view of the door PIN while it is shown: once when it appears
 * with its screen in front, and again each time the screen comes back to
 * the front. Refreshing the PIN in place is the same view.
 */
export const useAccessPinView = (focused: boolean): void => {
  useEffect(() => {
    if (focused) trackAccessPinViewed();
  }, [focused]);
};
