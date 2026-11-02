"use client";

import { Predicate } from "effect";
import { useMemo } from "react";
import {
  type AdvertisedPrice,
  isOfficeAdvertisedPrice,
  type OfficeAdvertisedPriceRequest,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
import type { CanonicalPromotionCode } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import { getReservationAdvertisedTotal } from "@/features/reservation/components/reservation-selection-summary";
import { useAdvertisedPrices } from "@/features/reservation/components/use-advertised-price";
import { getOfficeSeatAdvertisedPriceRequests } from "@/features/reservation/office-advertised-price";
import type { OfficeReservationDetails } from "@/features/reservation/office-reservation";

export type OfficeAdvertisedPrice = Extract<
  AdvertisedPrice,
  { readonly kind: "office" }
>;

type AdvertisedPriceQueryResult = ReturnType<
  typeof useAdvertisedPrices
>[number];

/** Each seat option's settled office price, keyed by seat count. */
export const getAdvertisedPricesBySeats = (
  requests: ReadonlyArray<OfficeAdvertisedPriceRequest>,
  queryResults: ReadonlyArray<AdvertisedPriceQueryResult>
) => {
  const pricesBySeats = new Map<number, OfficeAdvertisedPrice>();

  for (const [index, queryResult] of queryResults.entries()) {
    const request = requests[index];
    if (
      request &&
      !queryResult.isError &&
      queryResult.data &&
      isOfficeAdvertisedPrice(queryResult.data)
    ) {
      pricesBySeats.set(request.reservation.details.seats, queryResult.data);
    }
  }

  return pricesBySeats;
};

/** The selected seat count's price state the checkout form submits and shows. */
export const getOfficeCheckoutAdvertisedPrice = ({
  advertisedPrice,
  locale,
  queryResult,
}: {
  readonly advertisedPrice: OfficeAdvertisedPrice | undefined;
  readonly locale: Locale;
  readonly queryResult: AdvertisedPriceQueryResult | undefined;
}) => ({
  token: advertisedPrice?.advertisedPriceToken,
  isFetching: queryResult?.isFetching ?? false,
  isError: queryResult?.isError ?? false,
  retry: () => void queryResult?.refetch(),
  sale: advertisedPrice
    ? {
        discounts: advertisedPrice.quote.payment.discounts,
        productLabel: getWorkspaceOfficeProductTitle(locale),
      }
    : undefined,
  total: advertisedPrice
    ? getReservationAdvertisedTotal(advertisedPrice.quote.payment)
    : undefined,
});

/**
 * Every seat option's price for the selected dates, and the selected seat
 * count's checkout price.
 */
export const useOfficeAdvertisedPrices = ({
  initialAdvertisedPrices,
  locale,
  seatCapacity,
  seats,
  selection,
  submittedCode,
}: {
  readonly initialAdvertisedPrices: ReadonlyArray<PreloadedAdvertisedPrice>;
  readonly locale: Locale;
  readonly seatCapacity: number;
  readonly seats: number | undefined;
  readonly selection: OfficeReservationDetails | undefined;
  readonly submittedCode?: CanonicalPromotionCode;
}) => {
  const requests = useMemo(
    () =>
      selection
        ? getOfficeSeatAdvertisedPriceRequests({
            seatCapacity,
            locale,
            startsOn: selection.startsOn,
            endsOn: selection.endsOn,
            submittedCode,
          })
        : [],
    [seatCapacity, locale, selection, submittedCode]
  );
  const queryResults = useAdvertisedPrices(requests, initialAdvertisedPrices);
  const pricesBySeats = getAdvertisedPricesBySeats(requests, queryResults);
  const advertisedPrice = Predicate.isNumber(seats)
    ? pricesBySeats.get(seats)
    : undefined;

  return {
    advertisedPrice,
    checkoutAdvertisedPrice: getOfficeCheckoutAdvertisedPrice({
      advertisedPrice,
      locale,
      queryResult:
        queryResults[
          requests.findIndex(
            (request) => request.reservation.details.seats === seats
          )
        ],
    }),
    pricesBySeats,
  };
};
