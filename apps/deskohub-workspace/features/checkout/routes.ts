import type { Locale } from "@/features/i18n";

export const coworkReservationPath = "/checkout/reservation/cowork";
export const meetingRoomReservationPath = "/checkout/reservation/meeting-room";

export function getCoworkReservationPath(locale: Locale) {
  return `/${locale}${coworkReservationPath}`;
}

export function getMeetingRoomReservationPath(locale: Locale) {
  return `/${locale}${meetingRoomReservationPath}`;
}
