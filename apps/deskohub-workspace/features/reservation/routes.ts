import { Match } from "effect";
import type { Locale } from "@/features/i18n";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";

export const coworkReservationPath = "/reservation/cowork";
export const meetingRoomReservationPath = "/reservation/meeting-room";
export const reservationStatusPath = "/reservation/status";

export const getCoworkReservationPath = (locale: Locale) =>
  `/${locale}${coworkReservationPath}`;

export const getMeetingRoomReservationPath = (locale: Locale) =>
  `/${locale}${meetingRoomReservationPath}`;

export const getReservationStartPath = (
  locale: Locale,
  kind: ReservationOrderData["kind"],
  coworkSearchParams?: URLSearchParams
) =>
  Match.value({ kind }).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () => {
        const path = getCoworkReservationPath(locale);
        return coworkSearchParams ? `${path}?${coworkSearchParams}` : path;
      },
      "meeting-room": () => `/${locale}/meeting-room`,
    })
  );
