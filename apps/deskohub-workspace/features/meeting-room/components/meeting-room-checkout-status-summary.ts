import type { CheckoutMeetingRoomStatusSummary } from "@/features/checkout/backend/checkout";
import type { CheckoutStatusSummaryPresentation } from "@/features/checkout/checkout-status-summary-presentation";
import { getWorkspaceMeetingRoomProductTitle } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { formatMeetingRoomSetupStart } from "@/features/reservation/meeting-room-reservation-display-time";
import { formatMeetingRoomReservationDisplayTime } from "@/features/reservation/reservation.i18n";
import { formatReservationDisplayDate } from "@/features/reservation/reservation-date";
import { formatMoney } from "@/shared/money/money";

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
    ...(summary.setupFrom
      ? [
          {
            label: String(m.checkoutStatusSummarySetupLabel({}, { locale })),
            value: formatMeetingRoomSetupStart(
              {
                setupStart: summary.setupFrom,
                bookedStart: summary.reservedFrom,
              },
              locale
            ),
          },
        ]
      : []),
    {
      label: String(m.checkoutStatusSummaryPriceLabel({}, { locale })),
      value: formatMoney(summary.price, locale),
    },
  ],
});
