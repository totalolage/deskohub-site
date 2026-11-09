import type { CustomerReservationFamily } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { useIsFocused, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { trackBookingStarted } from "../../analytics/events";
import { useScrollScreenToTop } from "../../ui/scroll-screen";
import type { CheckoutRestartReason } from "../checkout/booking-problem";
import { reservationKindOf } from "../selection/booking-selection";
import { restartReasonOf } from "./booking-family-view";

/** Reports the booking started once, when the family's screen opens. */
export const useBookingStarted = (family: CustomerReservationFamily) => {
  useEffect(() => {
    trackBookingStarted(reservationKindOf(family));
  }, [family]);
};

/**
 * Why checkout sent the customer back here, from the `restart` parameter,
 * while the screen is in view. Each time it comes back into view with one
 * (checkout opened on top of it, then restarted the booking), even for the
 * same reason twice, `reread` reads availability and the quote again and
 * the screen scrolls back to its top, where the restart notice says why. A
 * screen that opens with the parameter reads them fresh and starts at the
 * top anyway.
 *
 * Out of view there's no reason, so the notice's live region empties under
 * the checkout and fills again on each return, once the screen is back in
 * view: assistive tech announces it every time, as the customer arrives.
 */
export const useRestartReason = (
  reread: () => void
): Option.Option<CheckoutRestartReason> => {
  const { restart } = useLocalSearchParams<{ restart?: string }>();
  const focused = useIsFocused();
  const scrollToTop = useScrollScreenToTop();
  const latest = useRef({ reread, scrollToTop });
  latest.current = { reread, scrollToTop };
  const focusedBefore = useRef(false);
  useEffect(() => {
    if (!focused) return;
    if (focusedBefore.current && Option.isSome(restartReasonOf(restart))) {
      latest.current.reread();
      latest.current.scrollToTop();
    }
    focusedBefore.current = true;
  }, [focused, restart]);
  return focused ? restartReasonOf(restart) : Option.none();
};
