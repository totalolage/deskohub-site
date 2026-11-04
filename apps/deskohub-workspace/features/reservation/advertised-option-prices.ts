import {
  type AdvertisedPrice,
  type AdvertisedPriceRequest,
  advertisedPriceRequestEquals,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import type { Money } from "@/shared/money/money";

/** The amount an option's card shows, with its price before the sale. */
type AdvertisedOptionAmount = {
  readonly amount: Money;
  readonly originalAmount?: Money;
};

/** An option's advertised amount and the advertised price it comes from. */
export type AdvertisedOptionPrice<Price extends AdvertisedPrice> =
  AdvertisedOptionAmount & { readonly advertisedPrice: Price };

/**
 * How a reservation family prices the options its form lets a customer pick:
 * which advertised prices belong to the family, and the amount an option's
 * card shows for its request's price.
 */
export type AdvertisedOptionFamily<
  Request extends AdvertisedPriceRequest,
  Price extends AdvertisedPrice,
> = {
  readonly isPrice: (price: AdvertisedPrice) => price is Price;
  readonly amountOf: (
    price: Price,
    request: Request
  ) => AdvertisedOptionAmount | undefined;
};

/**
 * The prices loaded for a form's option requests, looked up by the exact
 * request rather than a family key.
 */
export type AdvertisedOptionPrices<
  Request extends AdvertisedPriceRequest,
  Price extends AdvertisedPrice,
> = {
  readonly requests: ReadonlyArray<Request>;
  /**
   * The family's price for the request; undefined while it loads, after its
   * load failed, or for a request outside `requests`.
   */
  readonly priceOf: (request: Request) => Price | undefined;
  /** The option amount for the request, with the price it comes from. */
  readonly of: (request: Request) => AdvertisedOptionPrice<Price> | undefined;
};

export const findAdvertisedPriceRequestIndex = (
  requests: ReadonlyArray<AdvertisedPriceRequest>,
  request: AdvertisedPriceRequest | undefined
) =>
  request
    ? requests.findIndex((candidate) =>
        advertisedPriceRequestEquals(candidate, request)
      )
    : -1;

/** Option prices over a lookup of each request's loaded advertised price. */
export const getAdvertisedOptionPrices = <
  Request extends AdvertisedPriceRequest,
  Price extends AdvertisedPrice,
>(
  requests: ReadonlyArray<Request>,
  family: AdvertisedOptionFamily<Request, Price>,
  loadedPriceAt: (index: number) => AdvertisedPrice | undefined
): AdvertisedOptionPrices<Request, Price> => {
  const priceOf = (request: Request) => {
    const index = findAdvertisedPriceRequestIndex(requests, request);
    const price = index === -1 ? undefined : loadedPriceAt(index);
    return price && family.isPrice(price) ? price : undefined;
  };

  return {
    requests,
    priceOf,
    of: (request) => {
      const advertisedPrice = priceOf(request);
      const amount =
        advertisedPrice && family.amountOf(advertisedPrice, request);
      return amount && { ...amount, advertisedPrice };
    },
  };
};

/** Option prices from what a page preloaded for its form. */
export const getPreloadedOptionPrices = <
  Request extends AdvertisedPriceRequest,
  Price extends AdvertisedPrice,
>(
  requests: ReadonlyArray<Request>,
  family: AdvertisedOptionFamily<Request, Price>,
  preloaded: ReadonlyArray<PreloadedAdvertisedPrice>
) =>
  getAdvertisedOptionPrices(requests, family, (index) => {
    const request = requests[index];
    return (
      request &&
      preloaded.find((candidate) =>
        advertisedPriceRequestEquals(candidate.request, request)
      )?.advertisedPrice
    );
  });
