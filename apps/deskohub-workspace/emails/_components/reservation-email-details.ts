import { Match } from "effect";
import {
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import type { StoredCoworkReservationDetails } from "@/features/reservation/cowork-reservation-product";
import {
  formatMeetingRoomReservationDisplayTimeValue,
  formatMeetingRoomSetupStart,
} from "@/features/reservation/meeting-room-reservation-display-time";
import {
  formatReservationDisplayDate,
  formatReservationDisplayDateRange,
} from "@/features/reservation/reservation-date";
import type { WorkspaceEmailDetail } from "../workspace-email-detail";

/** The reservation facts that the reservation emails describe. */
export type ReservationEmailReservation = Pick<
  WorkspaceReservationDetails,
  | "id"
  | "dotyposReservationId"
  | "reservationDetails"
  | "reservedFrom"
  | "reservedUntil"
  | "setupFrom"
  | "seats"
>;

const coworkDetails = (
  reservation: ReservationEmailReservation,
  details: StoredCoworkReservationDetails,
  locale: Locale
): WorkspaceEmailDetail[] => [
  {
    label: m.reservationEmailTierLabel({}, { locale }),
    value: getWorkspaceProductTierTitle(details.entryTier, locale),
  },
  {
    label: m.reservationEmailDateLabel({}, { locale }),
    value: formatReservationDisplayDate(reservation.reservedFrom, locale),
  },
  {
    label: m.reservationEmailCoffeeLabel({}, { locale }),
    value: details.coffee
      ? m.checkoutStatusYes({}, { locale })
      : m.checkoutStatusNo({}, { locale }),
  },
  ...Match.value(details).pipe(
    Match.discriminatorsExhaustive("entryTier")({
      "open-space": () => [],
      "reserved-desk": ({ monitorOption }) =>
        monitorOption
          ? [
              {
                label: m.reservationEmailMonitorsLabel({}, { locale }),
                value: getWorkspaceProductMonitorTitle(monitorOption, locale),
              } satisfies WorkspaceEmailDetail,
            ]
          : [],
      basic: () => [],
      plus: () => [],
      profi: ({ monitorOption }) => [
        {
          label: m.reservationEmailMonitorsLabel({}, { locale }),
          value: getWorkspaceProductMonitorTitle(monitorOption, locale),
        } satisfies WorkspaceEmailDetail,
      ],
    })
  ),
];

/** A meeting-room booking's product, date, time and early-setup start. */
export const meetingRoomEmailDetails = (
  reservation: Pick<
    ReservationEmailReservation,
    "reservedFrom" | "reservedUntil" | "setupFrom"
  >,
  locale: Locale
): WorkspaceEmailDetail[] => [
  {
    label: m.reservationEmailReservationLabel({}, { locale }),
    value: m.reservationTierMeetingRoomTitle({}, { locale }),
  },
  {
    label: m.reservationEmailDateLabel({}, { locale }),
    value: formatReservationDisplayDate(reservation.reservedFrom, locale),
  },
  {
    label: m.reservationEmailTimeLabel({}, { locale }),
    value: formatMeetingRoomReservationDisplayTimeValue(
      {
        startsAt: reservation.reservedFrom,
        endsAt: reservation.reservedUntil,
      },
      locale,
      m.reservationMeetingRoomDurationWholeDay({}, { locale })
    ),
  },
  ...(reservation.setupFrom
    ? [
        {
          label: m.reservationEmailSetupLabel({}, { locale }),
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

const productDetails = (
  reservation: ReservationEmailReservation,
  locale: Locale
): WorkspaceEmailDetail[] =>
  Match.value(reservation.reservationDetails).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (details) => coworkDetails(reservation, details, locale),
      "meeting-room": () => meetingRoomEmailDetails(reservation, locale),
      office: () => [
        {
          label: m.reservationEmailReservationLabel({}, { locale }),
          value: getWorkspaceOfficeProductTitle(locale),
        },
        {
          label: m.reservationEmailDateLabel({}, { locale }),
          value: formatReservationDisplayDateRange(
            reservation.reservedFrom,
            reservation.reservedUntil,
            locale
          ),
        },
        {
          label: m.reservationEmailSeatsLabel({}, { locale }),
          value: String(reservation.seats),
        },
      ],
    })
  );

/**
 * What was booked and when, followed by the Dotypos reservation and order
 * references.
 */
export const reservationEmailDetails = (
  reservation: ReservationEmailReservation,
  locale: Locale
): WorkspaceEmailDetail[] => [
  ...productDetails(reservation, locale),
  ...(reservation.dotyposReservationId
    ? [
        {
          label: m.checkoutEmailDotyposReservationIdLabel({}, { locale }),
          value: reservation.dotyposReservationId,
        },
      ]
    : []),
  {
    label: m.checkoutStatusOrderIdLabel({}, { locale }),
    value: reservation.id,
  },
];
