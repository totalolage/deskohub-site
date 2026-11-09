"use client";

import type {
  AdvertisedPrice,
  AdvertisedPriceRequest,
  PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import {
  type AdvertisedOptionFamily,
  findAdvertisedPriceRequestIndex,
  getAdvertisedOptionPrices,
} from "@/features/reservation/advertised-option-prices";
import type { ReservationCheckoutAdvertisedPrice } from "@/features/reservation/components/reservation-checkout-form";
import { getReservationAdvertisedTotal } from "@/features/reservation/components/reservation-selection-summary";
import { useAdvertisedPrices } from "@/features/reservation/components/use-advertised-price";

/**
 * Loads a form's option prices and projects the selected option's price for
 * checkout. A price whose last load failed counts as missing, so its option
 * shows no amount and checkout offers a retry.
 */
export const useAdvertisedOptionPrices = <
  Request extends AdvertisedPriceRequest,
  Price extends AdvertisedPrice,
>({
  family,
  initialAdvertisedPrices,
  productLabel,
  requests,
  selected,
}: {
  readonly family: AdvertisedOptionFamily<Request, Price>;
  readonly initialAdvertisedPrices: ReadonlyArray<PreloadedAdvertisedPrice>;
  /** Names the selected option in checkout's sale notice. */
  readonly productLabel: string;
  /** One request per selectable option. */
  readonly requests: ReadonlyArray<Request>;
  /** The selected option's request, one of `requests`. */
  readonly selected: Request | undefined;
}) => {
  const results = useAdvertisedPrices(requests, initialAdvertisedPrices);
  const prices = getAdvertisedOptionPrices(requests, family, (index) => {
    const result = results[index];
    return result && !result.isError ? result.data : undefined;
  });
  const selectedResult =
    results[findAdvertisedPriceRequestIndex(requests, selected)];
  const selectedPrice = selected && prices.priceOf(selected);

  return {
    ...prices,
    selectedPrice,
    checkout: {
      token: selectedPrice?.advertisedPriceToken,
      isFetching: selectedResult?.isFetching ?? false,
      isError: selectedResult?.isError ?? false,
      retry: () => void selectedResult?.refetch(),
      sale: selectedPrice
        ? {
            discounts: selectedPrice.quote.payment.discounts,
            productLabel,
          }
        : undefined,
      total: selectedPrice
        ? getReservationAdvertisedTotal(selectedPrice.quote.payment)
        : undefined,
    } satisfies ReservationCheckoutAdvertisedPrice,
  };
};
