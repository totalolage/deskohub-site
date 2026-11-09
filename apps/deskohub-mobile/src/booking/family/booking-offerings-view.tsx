import type { CustomerBookingOfferings } from "@deskohub/workspace-customer-api";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { ReactNode } from "react";
import { useAppLocale } from "../../i18n/locale-context";
import { bookingOfferingsAtom } from "../data/booking-queries";
import { bookingReadOf } from "./booking-family-view";
import { BookingReadView } from "./booking-read-view";

/**
 * The booking catalog in the app's language, read only once the screen
 * renders it, so an account the gate turns away spends no catalog read.
 */
export function BookingOfferingsView({
  children,
}: {
  readonly children: (catalog: CustomerBookingOfferings) => ReactNode;
}) {
  const locale = useAppLocale();
  const offerings = useAtomValue(bookingOfferingsAtom(locale));
  const refresh = useAtomRefresh(bookingOfferingsAtom(locale));
  return (
    <BookingReadView read={bookingReadOf(offerings)} onRetry={refresh}>
      {children}
    </BookingReadView>
  );
}
