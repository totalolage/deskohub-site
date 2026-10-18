import {
  type AdvertisedPrice,
  type AdvertisedPriceRequest,
  advertisedPriceRequestEquals,
  getAdvertisedProductItem,
  isCoworkAdvertisedPrice,
  isOfficeAdvertisedPrice,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import {
  getPublicCatalogOfferings,
  type PublicCatalogOffering,
} from "@/features/checkout/public-offerings";
import { workspaceMoneyWithValue } from "@/features/checkout/workspace-money";
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
 * The cowork offerings at the prices the cowork form first shows for the
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
      const tierAmount = formRequests
        .filter(
          ({ reservation: { details } }) => details.entryTier === offering.tier
        )
        .map((request) => {
          const advertisedPrice = findCoworkAdvertisedPrice(request);
          return (
            advertisedPrice &&
            getAdvertisedProductItem(advertisedPrice, {
              kind: "cowork",
              tier: offering.tier,
            })?.amount
          );
        })
        .find((amount) => amount !== undefined);

      return {
        ...offering,
        price: tierAmount ?? offering.price,
        addOns: offering.addOns.map((addOn) => ({
          ...addOn,
          price: addOn.included
            ? addOn.price
            : (addOnAmounts[addOn.id] ?? addOn.price),
        })),
      } satisfies PublicCatalogOffering;
    });
};

/**
 * The meeting-room offerings at the prices the meeting-room form first shows
 * for the page's start time.
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
      const amount =
        advertisedPrice &&
        getAdvertisedProductItem(advertisedPrice, {
          kind: "meeting-room",
          duration: offering.duration,
        })?.amount;

      return {
        ...offering,
        price: amount ?? offering.price,
      } satisfies PublicCatalogOffering;
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
        price: workspaceMoneyWithValue(
          quoteItem.accessAmount.value / quoteItem.dayCount,
          quoteItem.accessAmount
        ),
        seatPrice: workspaceMoneyWithValue(
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
