import type { CheckoutStatusSummaryPresentation } from "@/features/checkout/checkout-status-summary-presentation";
import { getWorkspaceMeetingRoomDurationTitle } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import {
  getMeetingRoomReservationDuration,
  isMeetingRoomWholeDayReservationDuration,
  type MeetingRoomReservationDurationKey,
} from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import {
  formatReservationDisplayDate,
  formatReservationDisplayTimeRange,
} from "@/features/reservation/reservation-date";
import { withPlainSpaces } from "@/shared/utils/date-time-format";

/** The meeting-room selection as the contact-details step summarizes it. */
export const getMeetingRoomReservationSelectionSummary = (
  selection: {
    readonly durationKey: MeetingRoomReservationDurationKey;
    readonly startDateTime: string;
  },
  locale: Locale
): CheckoutStatusSummaryPresentation => {
  const duration = getMeetingRoomReservationDuration(selection.durationKey);
  const interval = getMeetingRoomReservationInterval(
    selection.startDateTime,
    duration
  );
  const isWholeDay = isMeetingRoomWholeDayReservationDuration(duration);

  return {
    reservationTitle: getWorkspaceMeetingRoomDurationTitle(duration, locale),
    rows: [
      ...(interval
        ? [
            {
              label: m.checkoutStatusSummaryDateLabel({}, { locale }),
              value: formatReservationDisplayDate(
                Temporal.Instant.from(interval.startsAt),
                locale
              ),
            },
            ...(isWholeDay
              ? []
              : [
                  {
                    label: m.checkoutStatusSummaryTimeLabel({}, { locale }),
                    // The summary renders on the server and in the browser.
                    value: withPlainSpaces(
                      formatReservationDisplayTimeRange(
                        Temporal.Instant.from(interval.startsAt),
                        Temporal.Instant.from(interval.endsAt),
                        locale
                      )
                    ),
                  },
                ]),
          ]
        : []),
    ],
  };
};
