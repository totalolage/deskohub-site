import type { Locale } from "@/features/i18n";

export const coworkReservationPath = "/checkout/reservation/cowork";

export function getCoworkReservationPath(locale: Locale) {
  return `/${locale}${coworkReservationPath}`;
}
