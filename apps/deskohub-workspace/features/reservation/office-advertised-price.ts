import {
  isOfficeAdvertisedPrice,
  type OfficeAdvertisedPrice,
  type OfficeAdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import type { CanonicalPromotionCode } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type { AdvertisedOptionFamily } from "@/features/reservation/advertised-option-prices";
import {
  getOfficeAdvertisedPriceReservation,
  getOfficeSeatOptions,
  type NormalizedOfficeReservationOrder,
} from "@/features/reservation/office-reservation";
import { moneyWithValue } from "@/shared/money/money";

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
  ...(reservation.submittedCode && {
    submittedCode: reservation.submittedCode,
  }),
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

/**
 * Each seat option shows what its seats add to the office's base price: the
 * quoted per-seat amount times its seats.
 */
export const officeSeatOptions: AdvertisedOptionFamily<
  OfficeAdvertisedPriceRequest,
  OfficeAdvertisedPrice
> = {
  isPrice: isOfficeAdvertisedPrice,
  amountOf: (price, { reservation: { details } }) => {
    const { seatAmount } = price.quote.items[0];
    return {
      amount: moneyWithValue(seatAmount.value * details.seats, seatAmount),
    };
  },
};

export const findOfficeSeatAdvertisedPriceRequest = (
  requests: ReadonlyArray<OfficeAdvertisedPriceRequest>,
  seats: number | undefined
) => requests.find(({ reservation: { details } }) => details.seats === seats);
