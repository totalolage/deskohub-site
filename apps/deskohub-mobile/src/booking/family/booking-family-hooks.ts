import type { CustomerReservationFamily } from "@deskohub/workspace-customer-api";
import type { Option } from "effect";
import { useIsFocused, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { trackBookingStarted } from "../../analytics/events";
import type { CheckoutRestartReason } from "../checkout/booking-problem";
import { reservationKindOf } from "../selection/booking-selection";
import { useRestartReasonInView } from "./restart-reason";

/** Reports the booking started once, when the family's screen opens. */
export const useBookingStarted = (family: CustomerReservationFamily) => {
  useEffect(() => {
    trackBookingStarted(reservationKindOf(family));
  }, [family]);
};

/**
 * Why checkout sent the customer back here, from the `restart` parameter,
 * while the screen is in view (see `useRestartReasonInView`).
 */
export const useRestartReason = (
  reread: () => void
): Option.Option<CheckoutRestartReason> => {
  const { restart } = useLocalSearchParams<{ restart?: string }>();
  return useRestartReasonInView(restart, useIsFocused(), reread);
};
