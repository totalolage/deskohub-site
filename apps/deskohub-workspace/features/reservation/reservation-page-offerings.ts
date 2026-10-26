import {
  type AdvertisedPrice,
  type AdvertisedPriceRequest,
  advertisedPriceRequestEquals,
  getAdvertisedProductItem,
  isCoworkAdvertisedPrice,
  isOfficeAdvertisedPrice,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
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
  getCoworkCoffeeAdvertisedPriceRequest,
  getCoworkFormAdvertisedPriceRequests,
} from "@/features/reservation/cowork-advertised-price";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import { getOfficeAdvertisedPriceRequest } from "@/features/reservation/office-advertised-price";
import type { NormalizedOfficeReservationOrder } from "@/features/reservation/office-reservation";
import { moneyWithValue } from "@/shared/money/money";

type ReservationPageOfferingsInput = {
  /** What the page preloaded for its form; anything missing keeps the catalog price. */
  readonly advertisedPrices: ReadonlyArray<PreloadedAdvertisedPrice>;
  readonly locale: Locale;
  readonly submittedCode?: CanonicalPromotionCode;
};

const findAdvertisedPrice = (
  advertisedPrices: ReadonlyArray<PreloadedAdvertisedPrice>,
  request: AdvertisedPriceRequest
): AdvertisedPrice | undefined =>
  advertisedPrices.find((preloaded) =>
    advertisedPriceRequestEquals(preloaded.request, request)
  )?.advertisedPrice;

/**
 * The price the product's order line advertises, with the sale it includes
 * against the line's regular amount.
 */
const getProductAdvertisedPrice = (
  advertisedPrice: AdvertisedPrice,
  product: WorkspaceProductIdentity
): PublicOfferingAdvertisedPrice | undefined => {
  const item = getAdvertisedProductItem(advertisedPrice, product);
  if (!item) return undefined;

  const regularAmount =
    "originalAmount" in item && item.originalAmount
      ? item.originalAmount
      : item.amount;
  const discount = moneyWithValue(
    regularAmount.value - item.amount.value,
    item.amount
  );
  const saleLastDay =
    discount.value > 0
      ? getReservationQuoteDiscountLastDay(advertisedPrice.quote.payment)
      : undefined;

  return { price: item.amount, discount, ...(saleLastDay && { saleLastDay }) };
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
  const formRequests = getCoworkFormAdvertisedPriceRequests({
    ...priceInput,
    coffee,
  });
  const findCoworkAdvertisedPrice = (request: AdvertisedPriceRequest) => {
    const advertisedPrice = findAdvertisedPrice(advertisedPrices, request);
    return advertisedPrice && isCoworkAdvertisedPrice(advertisedPrice)
      ? advertisedPrice
      : undefined;
  };
  const findAddOnAmount = (
    request: AdvertisedPriceRequest | undefined,
    type: "coffee" | "workstation"
  ) =>
    request &&
    findCoworkAdvertisedPrice(request)?.quote.items.find(
      (item) => item.type === type
    )?.amount;
  const addOnAmounts = {
    coffee: findAddOnAmount(
      getCoworkCoffeeAdvertisedPriceRequest({
        ...priceInput,
        tier: "open-space",
      }),
      "coffee"
    ),
    workstation: findAddOnAmount(
      formRequests.find(
        ({ reservation: { details } }) =>
          details.entryTier === "reserved-desk" && details.workstation
      ),
      "workstation"
    ),
  };

  return getPublicCatalogOfferings({ locale })
    .filter((offering) => offering.kind === "cowork")
    .map((offering) => {
      // Like the tier card, take the first price the form loads for the tier.
      const tierAdvertisedPrice = formRequests
        .filter(
          ({ reservation: { details } }) => details.entryTier === offering.tier
        )
        .map((request) => {
          const advertisedPrice = findCoworkAdvertisedPrice(request);
          return (
            advertisedPrice &&
            getProductAdvertisedPrice(advertisedPrice, {
              kind: "cowork",
              tier: offering.tier,
            })
          );
        })
        .find((price) => price !== undefined);

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
  const formRequests = getMeetingRoomDurationAdvertisedPriceRequests({
    locale,
    startDateTime,
    ...(submittedCode && { submittedCode }),
  });

  return getPublicCatalogOfferings({ locale })
    .filter((offering) => offering.kind === "meeting-room")
    .map((offering) => {
      const durationKey = getMeetingRoomReservationDurationKey(
        offering.duration
      );
      const request = formRequests.find(
        ({ reservation: { details } }) =>
          getMeetingRoomReservationDurationKey(details.duration) === durationKey
      );
      const advertisedPrice =
        request && findAdvertisedPrice(advertisedPrices, request);
      const durationAdvertisedPrice =
        advertisedPrice &&
        getProductAdvertisedPrice(advertisedPrice, {
          kind: "meeting-room",
          duration: offering.duration,
        });

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
  const advertisedPrice = findAdvertisedPrice(
    advertisedPrices,
    getOfficeAdvertisedPriceRequest({
      ...selection,
      locale,
      ...(submittedCode && { submittedCode }),
    })
  );
  const quoteItem =
    advertisedPrice && isOfficeAdvertisedPrice(advertisedPrice)
      ? advertisedPrice.quote.items[0]
      : undefined;
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
