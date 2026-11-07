import type { CustomerReservationFamily } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { trackBookingStarted } from "../../analytics/events";
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
 * Why checkout sent the customer back here, from the `restart` parameter.
 * Each time the screen comes back into focus with one (checkout opened on
 * top of it, then restarted the booking), `reread` reads availability and
 * the quote again, even for the same reason twice; a screen that opens with
 * the parameter reads them fresh anyway.
 */
export const useRestartReason = (
  reread: () => void
): Option.Option<CheckoutRestartReason> => {
  const { restart } = useLocalSearchParams<{ restart?: string }>();
  const reason = restartReasonOf(restart);
  const latest = useRef({ reason, reread });
  latest.current = { reason, reread };
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current && Option.isSome(latest.current.reason)) {
        latest.current.reread();
      }
      focusedBefore.current = true;
    }, [])
  );
  return reason;
};
