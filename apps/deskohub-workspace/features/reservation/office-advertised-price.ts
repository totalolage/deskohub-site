import type { AdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import type { Locale } from "@/features/i18n";
import {
  getOfficeAdditionalSeatOptions,
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

export const getOfficeAdditionalSeatAdvertisedPriceRequests = (
  reservation: Pick<NormalizedOfficeReservationOrder, "startsOn" | "endsOn"> & {
    readonly seatCapacity: number;
    readonly locale: Locale;
  }
) =>
  getOfficeAdditionalSeatOptions(reservation.seatCapacity).map(
    (additionalGuests) => ({
      additionalGuests,
      request: getOfficeAdvertisedPriceRequest({
        ...reservation,
        additionalGuests,
      }),
    })
  );
