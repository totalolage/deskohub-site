import type { CheckoutMeetingRoomStatusSummary } from "@/features/checkout/backend/checkout";
import type { CheckoutStatusSummaryPresentation } from "@/features/checkout/checkout-status-summary-presentation";
import { getWorkspaceMeetingRoomProductTitle } from "@/features/checkout/product-catalog.i18n";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { formatMeetingRoomReservationDisplayTime } from "@/features/reservation/reservation.i18n";
import { formatReservationDisplayDate } from "@/features/reservation/reservation-date";

export const getMeetingRoomCheckoutStatusSummary = (
  summary: CheckoutMeetingRoomStatusSummary,
  locale: Locale
): CheckoutStatusSummaryPresentation => ({
  reservationTitle: getWorkspaceMeetingRoomProductTitle(locale),
  rows: [
    {
      label: String(m.checkoutStatusSummaryReservationLabel({}, { locale })),
      value: getWorkspaceMeetingRoomProductTitle(locale),
    },
    {
      label: String(m.checkoutStatusSummaryDateLabel({}, { locale })),
      value: formatReservationDisplayDate(summary.reservedFrom, locale),
    },
    {
      label: String(m.checkoutStatusSummaryTimeLabel({}, { locale })),
      value: formatMeetingRoomReservationDisplayTime(
        {
          startsAt: summary.reservedFrom,
          endsAt: summary.reservedUntil,
        },
        locale
      ),
    },
    {
      label: String(m.checkoutStatusSummaryPriceLabel({}, { locale })),
      value: formatWorkspaceMoney(summary.price, locale),
    },
  ],
});
