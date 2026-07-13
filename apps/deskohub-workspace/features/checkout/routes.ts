import type { Locale } from "@/features/i18n";

export function getCoworkReservationPath(locale: Locale) {
  return `/${locale}/checkout/order`;
}

export function getMeetingRoomReservationPath(locale: Locale) {
  return `/${locale}/ttrpg-room`;
}
