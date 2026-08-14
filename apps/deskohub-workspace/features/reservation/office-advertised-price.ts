import type { OfficeAdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import type { CanonicalPromotionCode } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import {
  getOfficeAdvertisedPriceReservation,
  getOfficeSeatOptions,
  type NormalizedOfficeReservationOrder,
} from "@/features/reservation/office-reservation";

export const getOfficeAdvertisedPriceRequest = (
  reservation: Pick<
    NormalizedOfficeReservationOrder,
    "startsOn" | "endsOn" | "seats"
  > & {
    readonly locale: Locale;
    readonly submittedCode?: CanonicalPromotionCode;
  }
): OfficeAdvertisedPriceRequest => ({
  locale: reservation.locale,
  submittedCode: reservation.submittedCode,
  reservation: getOfficeAdvertisedPriceReservation(reservation),
});

export const getOfficeSeatAdvertisedPriceRequests = (
  reservation: Pick<NormalizedOfficeReservationOrder, "startsOn" | "endsOn"> & {
    readonly seatCapacity: number;
    readonly locale: Locale;
    readonly submittedCode?: CanonicalPromotionCode;
  }
) =>
  getOfficeSeatOptions(reservation.seatCapacity).map(
    (seats): OfficeAdvertisedPriceRequest =>
      getOfficeAdvertisedPriceRequest({
        ...reservation,
        seats,
      })
  );
