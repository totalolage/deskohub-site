import type { CustomerReservationFamily } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
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
 * When it arrives on a screen already open, `reread` reads availability and
 * the quote again; a screen that opens with it reads them fresh anyway.
 */
export const useRestartReason = (
  reread: () => void
): Option.Option<CheckoutRestartReason> => {
  const { restart } = useLocalSearchParams<{ restart?: string }>();
  const reason = restartReasonOf(restart);
  const key = Option.getOrUndefined(reason);
  const opened = useRef(false);
  const rereadRef = useRef(reread);
  rereadRef.current = reread;
  useEffect(() => {
    if (opened.current && key !== undefined) rereadRef.current();
    opened.current = true;
  }, [key]);
  return reason;
};
