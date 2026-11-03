import type {
  AdvertisedPrice,
  PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import {
  getPublicCatalogOfferings,
  type PublicCatalogOffering,
  type PublicOfferingAdvertisedPrice,
  type PublicPriceListOffering,
} from "@/features/checkout/public-offerings";
import { getReservationQuoteDiscountLastDay } from "@/features/checkout/reservation-quote-schema";
import type { CanonicalPromotionCode } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import {
  type AdvertisedOptionPrice,
  getPreloadedOptionPrices,
} from "@/features/reservation/advertised-option-prices";
import {
  coworkTierOptions,
  findCoworkAdvertisedPriceRequest,
  getCoworkAddOnAmount,
  getCoworkCoffeeAdvertisedPriceRequest,
  getCoworkFormAdvertisedPriceRequests,
  getCoworkTierOptionPrice,
} from "@/features/reservation/cowork-advertised-price";
import {
  findMeetingRoomDurationAdvertisedPriceRequest,
  getMeetingRoomDurationAdvertisedPriceRequests,
  meetingRoomDurationOptions,
} from "@/features/reservation/meeting-room-advertised-price";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import {
  getOfficeAdvertisedPriceRequest,
  officeSeatOptions,
} from "@/features/reservation/office-advertised-price";
import type { NormalizedOfficeReservationOrder } from "@/features/reservation/office-reservation";
import { moneyWithValue } from "@/shared/money/money";

type ReservationPageOfferingsInput = {
  /** What the page preloaded for its form; anything missing keeps the catalog price. */
  readonly advertisedPrices: ReadonlyArray<PreloadedAdvertisedPrice>;
  readonly locale: Locale;
  readonly submittedCode?: CanonicalPromotionCode;
};

/**
 * The price an option's card advertises, with the sale it includes against
 * the option's regular amount.
 */
const getOfferingAdvertisedPrice = ({
  advertisedPrice,
  amount,
  originalAmount,
}: AdvertisedOptionPrice<AdvertisedPrice>): PublicOfferingAdvertisedPrice => {
  const discount = moneyWithValue(
    (originalAmount ?? amount).value - amount.value,
    amount
  );
  const saleLastDay =
    discount.value > 0
      ? getReservationQuoteDiscountLastDay(advertisedPrice.quote.payment)
      : undefined;

  return { price: amount, discount, ...(saleLastDay && { saleLastDay }) };
};

/**
 * The cowork offerings with the prices the cowork form first shows for the
 * page's selection.
 */
export const getCoworkPageOfferings = ({
  advertisedPrices,
  coffee,
  date,
  locale,
  submittedCode,
}: ReservationPageOfferingsInput & {
  readonly coffee: boolean;
  readonly date: string;
}) => {
  const priceInput = { date, locale, ...(submittedCode && { submittedCode }) };
  const prices = getPreloadedOptionPrices(
    getCoworkFormAdvertisedPriceRequests({ ...priceInput, coffee }),
    coworkTierOptions,
    advertisedPrices
  );
  const coffeeRequest = getCoworkCoffeeAdvertisedPriceRequest({
    ...priceInput,
    tier: "open-space",
  });
  const workstationRequest = findCoworkAdvertisedPriceRequest(prices.requests, {
    entryTier: "reserved-desk",
    workstation: true,
  });
  const addOnAmounts = {
    coffee: getCoworkAddOnAmount(
      getPreloadedOptionPrices(
        [coffeeRequest],
        coworkTierOptions,
        advertisedPrices
      ).priceOf(coffeeRequest),
      "coffee"
    ),
    workstation: getCoworkAddOnAmount(
      workstationRequest && prices.priceOf(workstationRequest),
      "workstation"
    ),
  };

  return getPublicCatalogOfferings({ locale })
    .filter((offering) => offering.kind === "cowork")
    .map((offering) => {
      const tierPrice = getCoworkTierOptionPrice(prices, offering.tier);
      const tierAdvertisedPrice =
        tierPrice && getOfferingAdvertisedPrice(tierPrice);

      return {
        ...offering,
        ...(tierAdvertisedPrice && { advertisedPrice: tierAdvertisedPrice }),
        addOns: offering.addOns.map((addOn) => ({
          ...addOn,
          price: addOn.included
            ? addOn.price
            : (addOnAmounts[addOn.id] ?? addOn.price),
        })),
      } satisfies PublicPriceListOffering;
    });
};

/**
 * The meeting-room offerings with the prices the meeting-room form first
 * shows for the page's start time.
 */
export const getMeetingRoomPageOfferings = ({
  advertisedPrices,
  locale,
  startDateTime,
  submittedCode,
}: ReservationPageOfferingsInput & { readonly startDateTime: string }) => {
  const prices = getPreloadedOptionPrices(
    getMeetingRoomDurationAdvertisedPriceRequests({
      locale,
      startDateTime,
      ...(submittedCode && { submittedCode }),
    }),
    meetingRoomDurationOptions,
    advertisedPrices
  );

  return getPublicCatalogOfferings({ locale })
    .filter((offering) => offering.kind === "meeting-room")
    .map((offering) => {
      const request = findMeetingRoomDurationAdvertisedPriceRequest(
        prices.requests,
        getMeetingRoomReservationDurationKey(offering.duration)
      );
      const durationPrice = request && prices.of(request);
      const durationAdvertisedPrice =
        durationPrice && getOfferingAdvertisedPrice(durationPrice);

      return {
        ...offering,
        ...(durationAdvertisedPrice && {
          advertisedPrice: durationAdvertisedPrice,
        }),
      } satisfies PublicPriceListOffering;
    });
};

/**
 * The office offering at the day and seat prices the office form first shows
 * for the page's selection.
 */
export const getOfficePageOfferings = ({
  advertisedPrices,
  locale,
  seatCapacity,
  selection,
  submittedCode,
}: ReservationPageOfferingsInput & {
  readonly seatCapacity: number;
  readonly selection: Pick<
    NormalizedOfficeReservationOrder,
    "startsOn" | "endsOn" | "seats"
  >;
}) => {
  const request = getOfficeAdvertisedPriceRequest({
    ...selection,
    locale,
    ...(submittedCode && { submittedCode }),
  });
  const quoteItem = getPreloadedOptionPrices(
    [request],
    officeSeatOptions,
    advertisedPrices
  ).priceOf(request)?.quote.items[0];
  // The form shows the selection's whole-range amounts; the offer is per day.
  const perDay = quoteItem
    ? {
        price: moneyWithValue(
          quoteItem.accessAmount.value / quoteItem.dayCount,
          quoteItem.accessAmount
        ),
        seatPrice: moneyWithValue(
          quoteItem.seatAmount.value / quoteItem.dayCount,
          quoteItem.seatAmount
        ),
      }
    : {};

  return getPublicCatalogOfferings({
    locale,
    office: { maximumSeats: seatCapacity },
  })
    .filter((offering) => offering.kind === "office")
    .map(
      (offering) => ({ ...offering, ...perDay }) satisfies PublicCatalogOffering
    );
};
