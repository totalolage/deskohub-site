import type { Locale } from "@/features/i18n";
import {
  formatReservationDisplayDateTime,
  formatReservationDisplayTimeRange,
  getWorkspaceDate,
} from "@/features/reservation/reservation-date";
import { isSingleDayReservationInterval } from "@/features/reservation/reservation-interval-domain";
import { formatInstantTime } from "@/shared/utils/date-time-format";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

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

/**
 * When an early-setup meeting room's customer may arrive, as a time of day
 * beside its booked time. A setup start on the day before the booked start,
 * as for a booking from midnight, keeps its date.
 */
export const formatMeetingRoomSetupStart = (
  booking: {
    readonly setupStart: Temporal.Instant;
    readonly bookedStart: Temporal.Instant;
  },
  locale: Locale
) =>
  getWorkspaceDate(booking.setupStart).equals(
    getWorkspaceDate(booking.bookedStart)
  )
    ? formatInstantTime({
        instant: booking.setupStart,
        locale,
        timeZone: workspaceSiteConstants.location.timeZone,
      })
    : formatReservationDisplayDateTime(booking.setupStart, locale);
