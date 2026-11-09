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
) => withSearchParams(`/${locale}${getReservationPath(kind)}`, searchParams);

/**
 * A reservation page path without a locale prefix, for links shared outside
 * the app: the proxy opens them in the recipient's language.
 */
export const getShareableReservationStartPath = (
  kind: ReservationOrderData["kind"],
  searchParams?: URLSearchParams
) => withSearchParams(getReservationPath(kind), searchParams);

const getReservationPath = (kind: ReservationOrderData["kind"]) =>
  Match.value({ kind }).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () => coworkReservationPath,
      "meeting-room": () => meetingRoomReservationPath,
      office: () => officeReservationPath,
    })
  );

const withSearchParams = (path: string, searchParams?: URLSearchParams) =>
  searchParams?.size ? `${path}?${searchParams}` : path;
