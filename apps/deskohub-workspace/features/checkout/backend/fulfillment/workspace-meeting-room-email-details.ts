import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import { formatMeetingRoomReservationDisplayTimeValue } from "@/features/reservation/meeting-room-reservation-display-time";
import { formatReservationDisplayDate } from "@/features/reservation/reservation-date";
import type { EmailDetailRow } from "@/shared/backend/email/rendering";

export interface WorkspaceMeetingRoomEmailCopy {
  readonly dateLabel: string;
  readonly reservationLabel: string;
  readonly reservationTitle: string;
  readonly timeLabel: string;
  readonly wholeDay: string;
}

type MeetingRoomEmailReservation = Pick<
  WorkspaceReservationDetails,
  "reservedFrom" | "reservedUntil"
>;

export const createWorkspaceMeetingRoomEmailDetailRows = (
  reservation: MeetingRoomEmailReservation,
  locale: Locale,
  copy: WorkspaceMeetingRoomEmailCopy
): EmailDetailRow[] => [
  [copy.reservationLabel, copy.reservationTitle],
  [
    copy.dateLabel,
    formatReservationDisplayDate(reservation.reservedFrom, locale),
  ],
  [
    copy.timeLabel,
    formatMeetingRoomReservationDisplayTimeValue(
      {
        startsAt: reservation.reservedFrom,
        endsAt: reservation.reservedUntil,
      },
      locale,
      copy.wholeDay
    ),
  ],
];
