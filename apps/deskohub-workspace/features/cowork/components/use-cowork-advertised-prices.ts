"use client";

import { useMemo } from "react";
import {
  isCoworkAdvertisedPrice,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { getWorkspaceProductTierTitle } from "@/features/checkout/product-catalog.i18n";
import type { CanonicalPromotionCode } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import { useAdvertisedOptionPrices } from "@/features/reservation/components/use-advertised-option-prices";
import { useAdvertisedPrices } from "@/features/reservation/components/use-advertised-price";
import {
  coworkTierOptions,
  findCoworkAdvertisedPriceRequest,
  getCoworkAddOnAmount,
  getCoworkCoffeeAdvertisedPriceRequest,
  getCoworkFormAdvertisedPriceRequests,
} from "@/features/reservation/cowork-advertised-price";
import type { CoworkReservationInput } from "@/features/reservation/cowork-reservation";
import { formatMoney, type Money } from "@/shared/money/money";

type CoworkPriceSelection = Pick<
  CoworkReservationInput,
  "coffee" | "date" | "entryTier" | "monitorOption"
>;

type CoworkPriceInput = {
  readonly initialAdvertisedPrices: ReadonlyArray<PreloadedAdvertisedPrice>;
  readonly locale: Locale;
  readonly submittedCode?: CanonicalPromotionCode;
};

/** An addon's formatted price, once its price has loaded. */
const formatAddonPrice = (amount: Money | undefined, locale: Locale) =>
  amount ? formatMoney(amount, locale) : undefined;

/** The coffee addon's formatted price for an Open Space day. */
const useCoworkCoffeePriceLabel = ({
  initialAdvertisedPrices,
  locale,
  selection: { date, entryTier },
  submittedCode,
}: CoworkPriceInput & {
  readonly selection: Pick<CoworkPriceSelection, "date" | "entryTier">;
}) => {
  const request = useMemo(
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
  const [queryResult] = useAdvertisedPrices(
    request ? [request] : [],
    initialAdvertisedPrices
  );
  const advertisedPrice =
    queryResult?.data && isCoworkAdvertisedPrice(queryResult.data)
      ? queryResult.data
      : undefined;

  return formatAddonPrice(
    getCoworkAddOnAmount(advertisedPrice, "coffee"),
    locale
  );
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
}: CoworkPriceInput & { readonly selection: CoworkPriceSelection }) => {
  const { coffee, date, entryTier, monitorOption } = selection;
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
  const advertisedPrices = useAdvertisedOptionPrices({
    family: coworkTierOptions,
    initialAdvertisedPrices,
    productLabel: getWorkspaceProductTierTitle(entryTier, locale),
    requests,
    selected: findCoworkAdvertisedPriceRequest(requests, {
      entryTier,
      workstation: monitorOption !== undefined,
    }),
  });
  const coffeePriceLabel = useCoworkCoffeePriceLabel({
    initialAdvertisedPrices,
    locale,
    selection,
    submittedCode,
  });
  const workstationRequest = findCoworkAdvertisedPriceRequest(requests, {
    entryTier: "reserved-desk",
    workstation: true,
  });

  return {
    advertisedPrices,
    coffeePriceLabel,
    workstationPriceLabel: formatAddonPrice(
      getCoworkAddOnAmount(
        workstationRequest && advertisedPrices.priceOf(workstationRequest),
        "workstation"
      ),
      locale
    ),
  };
};
