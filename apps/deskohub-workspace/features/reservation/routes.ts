import { Match } from "effect";
import type { Locale } from "@/features/i18n";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";

export const coworkReservationPath = "/reservation/cowork";
export const meetingRoomReservationPath = "/reservation/meeting-room";
export const officeReservationPath = "/reservation/office";
export const reservationAccessPath = "/reservation/access";
export const reservationInvoicePath = "/reservation/invoice";
export const reservationStatusPath = "/reservation/status";

export const getCoworkReservationPath = (locale: Locale) =>
  `/${locale}${coworkReservationPath}`;

export const getMeetingRoomReservationPath = (locale: Locale) =>
  `/${locale}${meetingRoomReservationPath}`;

export const getOfficeReservationPath = (locale: Locale) =>
  `/${locale}${officeReservationPath}`;

export const getReservationStartPath = (
  locale: Locale,
  kind: ReservationOrderData["kind"],
  searchParams?: URLSearchParams
) =>
  Match.value({ kind }).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () => {
        const path = getCoworkReservationPath(locale);
        return searchParams ? `${path}?${searchParams}` : path;
      },
      "meeting-room": () => {
        const path = getMeetingRoomReservationPath(locale);
        return searchParams ? `${path}?${searchParams}` : path;
      },
      office: () => {
        const path = getOfficeReservationPath(locale);
        return searchParams ? `${path}?${searchParams}` : path;
      },
    })
  );
