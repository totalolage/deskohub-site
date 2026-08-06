import type { AdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import type { Locale } from "@/features/i18n";
import {
  getOfficeAdvertisedPriceReservation,
  type NormalizedOfficeReservationOrder,
} from "@/features/reservation/office-reservation";

export const getOfficeAdvertisedPriceRequest = (
  reservation: Pick<
    NormalizedOfficeReservationOrder,
    "startsOn" | "endsOn" | "additionalGuests"
  > & { readonly locale: Locale }
): AdvertisedPriceRequest => ({
  locale: reservation.locale,
  reservation: getOfficeAdvertisedPriceReservation(reservation),
});
