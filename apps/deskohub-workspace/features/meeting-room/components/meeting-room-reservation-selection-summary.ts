import type { CheckoutStatusSummaryPresentation } from "@/features/checkout/checkout-status-summary-presentation";
import { getWorkspaceMeetingRoomDurationTitle } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import type { MeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import {
  formatReservationDisplayDate,
  formatReservationDisplayTimeRange,
} from "@/features/reservation/reservation-date";
import type { ReservationInterval } from "@/features/reservation/reservation-interval-domain";

/** The meeting-room selection as the contact-details step summarizes it. */
export const getMeetingRoomReservationSelectionSummary = (
  selection: {
    readonly duration: MeetingRoomReservationDuration;
    readonly interval: ReservationInterval | null;
    readonly isWholeDay: boolean;
  },
  locale: Locale
): CheckoutStatusSummaryPresentation => ({
  reservationTitle: getWorkspaceMeetingRoomDurationTitle(
    selection.duration,
    locale
  ),
  rows: [
    ...(selection.interval
      ? [
          {
            label: m.checkoutStatusSummaryDateLabel({}, { locale }),
            value: formatReservationDisplayDate(
              Temporal.Instant.from(selection.interval.startsAt),
              locale
            ),
          },
          ...(selection.isWholeDay
            ? []
            : [
                {
                  label: m.checkoutStatusSummaryTimeLabel({}, { locale }),
                  value: formatReservationDisplayTimeRange(
                    Temporal.Instant.from(selection.interval.startsAt),
                    Temporal.Instant.from(selection.interval.endsAt),
                    locale
                  ),
                },
              ]),
        ]
      : []),
  ],
});
