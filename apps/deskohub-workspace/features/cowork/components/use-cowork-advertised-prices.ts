"use client";

import { Match } from "effect";
import { useMemo } from "react";
import {
  type AdvertisedPrice,
  type CoworkAdvertisedPriceRequest,
  isCoworkAdvertisedPrice,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { getWorkspaceProductTierTitle } from "@/features/checkout/product-catalog.i18n";
import type { CanonicalPromotionCode } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import { getReservationAdvertisedTotal } from "@/features/reservation/components/reservation-selection-summary";
import { useAdvertisedPrices } from "@/features/reservation/components/use-advertised-price";
import {
  getCoworkCoffeeAdvertisedPriceRequest,
  getCoworkFormAdvertisedPriceRequests,
} from "@/features/reservation/cowork-advertised-price";
import type { CoworkReservationInput } from "@/features/reservation/cowork-reservation";
import { formatMoney } from "@/shared/money/money";

type CoworkAdvertisedPrice = Extract<
  AdvertisedPrice,
  { readonly kind: "cowork" }
>;

type AdvertisedPriceQueryResult = ReturnType<
  typeof useAdvertisedPrices
>[number];

type CoworkPriceSelection = Pick<
  CoworkReservationInput,
  "coffee" | "date" | "entryTier" | "monitorOption"
>;

/** A cowork price from a query's data, whatever the query's status. */
const toCoworkAdvertisedPrice = (data: AdvertisedPrice | undefined) =>
  isCoworkAdvertisedPrice(data) ? data : undefined;

/** A cowork price the query currently holds without an error. */
const getSettledCoworkAdvertisedPrice = (
  queryResult: AdvertisedPriceQueryResult | undefined
) =>
  queryResult?.isError ? undefined : toCoworkAdvertisedPrice(queryResult?.data);

/** An addon's formatted price from a cowork price that includes the addon. */
const getAdvertisedAddonPriceLabel = (
  advertisedPrice: CoworkAdvertisedPrice | undefined,
  addon: "coffee" | "workstation",
  locale: Locale
) => {
  const amount = advertisedPrice?.quote.items.find(
    ({ type }) => type === addon
  )?.amount;
  return amount ? formatMoney(amount, locale) : undefined;
};

/** Whether a request prices a Reserved Desk with the workstation addon. */
const isWorkstationPriceRequest = ({
  reservation,
}: CoworkAdvertisedPriceRequest) =>
  Match.value(reservation.details).pipe(
    Match.when({ entryTier: "reserved-desk", workstation: true }, () => true),
    Match.when({ entryTier: "reserved-desk", workstation: false }, () => false),
    Match.when({ entryTier: "open-space" }, () => false),
    Match.when({ entryTier: "basic" }, () => false),
    Match.when({ entryTier: "plus" }, () => false),
    Match.when({ entryTier: "profi" }, () => false),
    Match.exhaustive
  );

/** Whether a request prices the customer's selected offer. */
const isSelectedCoworkPriceRequest = (
  { reservation }: CoworkAdvertisedPriceRequest,
  { entryTier, monitorOption }: CoworkPriceSelection
) =>
  Match.value(reservation.details).pipe(
    Match.when({ entryTier: "open-space" }, () => entryTier === "open-space"),
    Match.when(
      { entryTier: "reserved-desk", workstation: true },
      () => entryTier === "reserved-desk" && monitorOption !== undefined
    ),
    Match.when(
      { entryTier: "reserved-desk", workstation: false },
      () => entryTier === "reserved-desk" && monitorOption === undefined
    ),
    Match.when({ entryTier: "basic" }, () => false),
    Match.when({ entryTier: "plus" }, () => false),
    Match.when({ entryTier: "profi" }, () => false),
    Match.exhaustive
  );

/**
 * Each tier card's price, keyed by tier. Both Reserved Desk variants share
 * the tier key; the tier card shows the base product price, identical across
 * the workstation variants, so the first loaded variant wins.
 */
const getAdvertisedPricesByTier = (
  requests: ReadonlyArray<CoworkAdvertisedPriceRequest>,
  queryResults: ReadonlyArray<AdvertisedPriceQueryResult>
) => {
  const pricesByTier = new Map<string, CoworkAdvertisedPrice>();

  for (const [index, queryResult] of queryResults.entries()) {
    const request = requests[index];
    const advertisedPrice = getSettledCoworkAdvertisedPrice(queryResult);
    if (
      request &&
      advertisedPrice &&
      !pricesByTier.has(request.reservation.details.entryTier)
    ) {
      pricesByTier.set(request.reservation.details.entryTier, advertisedPrice);
    }
  }

  return pricesByTier;
};

/** The selected offer's price state the checkout form submits and shows. */
const getCoworkCheckoutAdvertisedPrice = (
  queryResult: AdvertisedPriceQueryResult | undefined,
  entryTier: CoworkReservationInput["entryTier"],
  locale: Locale
) => {
  const advertisedPrice = getSettledCoworkAdvertisedPrice(queryResult);

  return {
    token: advertisedPrice?.advertisedPriceToken,
    isFetching: Boolean(queryResult?.isFetching),
    isError: Boolean(queryResult?.isError),
    retry: () => void queryResult?.refetch(),
    sale: advertisedPrice && {
      discounts: advertisedPrice.quote.payment.discounts,
      productLabel: getWorkspaceProductTierTitle(entryTier, locale),
    },
    total:
      advertisedPrice &&
      getReservationAdvertisedTotal(advertisedPrice.quote.payment),
  };
};

/**
 * Every price the cowork form shows for the selected date: each tier card,
 * the coffee and workstation addons, and the selected offer's checkout price.
 */
export const useCoworkAdvertisedPrices = ({
  initialAdvertisedPrices,
  locale,
  selection,
  submittedCode,
}: {
  readonly initialAdvertisedPrices: ReadonlyArray<PreloadedAdvertisedPrice>;
  readonly locale: Locale;
  readonly selection: CoworkPriceSelection;
  readonly submittedCode?: CanonicalPromotionCode;
}) => {
  const { coffee, date, entryTier } = selection;
  const requests = useMemo(
    () =>
      date
        ? getCoworkFormAdvertisedPriceRequests({
            coffee: Boolean(coffee),
            date,
            locale,
            submittedCode,
          })
        : [],
    [coffee, date, locale, submittedCode]
  );
  const queryResults = useAdvertisedPrices(requests, initialAdvertisedPrices);
  const coffeeRequest = useMemo(
    () =>
      date && entryTier === "open-space"
        ? getCoworkCoffeeAdvertisedPriceRequest({
            date,
            locale,
            submittedCode,
            tier: entryTier,
          })
        : undefined,
    [date, entryTier, locale, submittedCode]
  );
  const [coffeeQueryResult] = useAdvertisedPrices(
    coffeeRequest ? [coffeeRequest] : [],
    initialAdvertisedPrices
  );

  return {
    checkoutAdvertisedPrice: getCoworkCheckoutAdvertisedPrice(
      queryResults[
        requests.findIndex((request) =>
          isSelectedCoworkPriceRequest(request, selection)
        )
      ],
      entryTier,
      locale
    ),
    coffeePriceLabel: getAdvertisedAddonPriceLabel(
      toCoworkAdvertisedPrice(coffeeQueryResult?.data),
      "coffee",
      locale
    ),
    pricesByTier: getAdvertisedPricesByTier(requests, queryResults),
    workstationPriceLabel: getAdvertisedAddonPriceLabel(
      getSettledCoworkAdvertisedPrice(
        queryResults[requests.findIndex(isWorkstationPriceRequest)]
      ),
      "workstation",
      locale
    ),
  };
};
