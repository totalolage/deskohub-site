import type { Locale } from "@/features/i18n";
import { formatReservationDisplayTimeRange } from "@/features/reservation/reservation-date";
import { isSingleDayReservationInterval } from "@/features/reservation/reservation-interval-domain";

interface MeetingRoomReservationDisplayInterval {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
}

export const formatMeetingRoomReservationDisplayTimeValue = (
  interval: MeetingRoomReservationDisplayInterval,
  locale: Locale,
  wholeDayLabel: string
) =>
  isSingleDayReservationInterval(interval)
    ? wholeDayLabel
    : formatReservationDisplayTimeRange(
        interval.startsAt,
        interval.endsAt,
        locale
      );
