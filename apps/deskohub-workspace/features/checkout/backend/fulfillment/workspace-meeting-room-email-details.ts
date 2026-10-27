import type { WorkspaceEmailDetail } from "@/emails/workspace-email-detail";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import {
  formatMeetingRoomReservationDisplayTimeValue,
  formatMeetingRoomSetupStart,
} from "@/features/reservation/meeting-room-reservation-display-time";
import { formatReservationDisplayDate } from "@/features/reservation/reservation-date";

export interface WorkspaceMeetingRoomEmailCopy {
  readonly dateLabel: string;
  readonly reservationLabel: string;
  readonly reservationTitle: string;
  readonly setupLabel: string;
  readonly timeLabel: string;
  readonly wholeDay: string;
}

type MeetingRoomEmailReservation = Pick<
  WorkspaceReservationDetails,
  "reservedFrom" | "reservedUntil" | "setupFrom"
>;

export const createWorkspaceMeetingRoomEmailDetailRows = (
  reservation: MeetingRoomEmailReservation,
  locale: Locale,
  copy: WorkspaceMeetingRoomEmailCopy
): WorkspaceEmailDetail[] => [
  { label: copy.reservationLabel, value: copy.reservationTitle },
  {
    label: copy.dateLabel,
    value: formatReservationDisplayDate(reservation.reservedFrom, locale),
  },
  {
    label: copy.timeLabel,
    value: formatMeetingRoomReservationDisplayTimeValue(
      {
        startsAt: reservation.reservedFrom,
        endsAt: reservation.reservedUntil,
      },
      locale,
      copy.wholeDay
    ),
  },
  ...(reservation.setupFrom
    ? [
        {
          label: copy.setupLabel,
          value: formatMeetingRoomSetupStart(
            {
              setupStart: reservation.setupFrom,
              bookedStart: reservation.reservedFrom,
            },
            locale
          ),
        },
      ]
    : []),
];
