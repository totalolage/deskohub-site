import { Match } from "effect";
import {
  type CoworkAdvertisedPrice,
  type CoworkAdvertisedPriceRequest,
  getAdvertisedProductAmount,
  isCoworkAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import {
  type WorkspaceCoworkCurrentTier,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import type { CanonicalPromotionCode } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type {
  AdvertisedOptionFamily,
  AdvertisedOptionPrices,
} from "@/features/reservation/advertised-option-prices";
import { getCoworkAdvertisedPriceReservation } from "@/features/reservation/cowork-reservation";

type CoworkAdvertisedPriceOfferSelection = {
  readonly entryTier: WorkspaceCoworkCurrentTier;
  readonly coffee: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

const getCoworkTierAdvertisedPriceRequests = ({
  date,
  locale,
  offers,
  submittedCode,
}: {
  readonly date: string;
  readonly locale: Locale;
  readonly offers: ReadonlyArray<CoworkAdvertisedPriceOfferSelection>;
  readonly submittedCode?: CanonicalPromotionCode;
}): ReadonlyArray<CoworkAdvertisedPriceRequest> =>
  offers.map((offer) => ({
    locale,
    ...(submittedCode && { submittedCode }),
    reservation: getCoworkAdvertisedPriceReservation({
      entryTier: offer.entryTier,
      coffee: offer.coffee,
      ...(offer.monitorOption !== undefined && {
        monitorOption: offer.monitorOption,
      }),
      date,
    }),
  }));

// Both Reserved Desk variants are advertised so the paid workstation addon
// price is visible before the toggle is flipped. The canonical monitor option
// is display-only: workstation presence, not the chosen configuration,
// determines the amount, so the request never changes with the selection.
const reservedDeskAdvertisedOffers = [
  { entryTier: "reserved-desk", coffee: true },
  {
    entryTier: "reserved-desk",
    coffee: true,
    monitorOption: workspaceProductMonitorOptions[0],
  },
] as const satisfies ReadonlyArray<CoworkAdvertisedPriceOfferSelection>;

type CoworkDateAdvertisedPriceInput = {
  readonly date: string;
  readonly locale: Locale;
  readonly submittedCode?: CanonicalPromotionCode;
};

/** The tier card prices the cowork form shows for its coffee choice. */
export const getCoworkFormAdvertisedPriceRequests = ({
  coffee,
  ...input
}: CoworkDateAdvertisedPriceInput & { readonly coffee: boolean }) =>
  getCoworkTierAdvertisedPriceRequests({
    ...input,
    offers: [
      { entryTier: "open-space", coffee },
      ...reservedDeskAdvertisedOffers,
    ],
  });

/**
 * Every cowork price the form can show on a date, whatever is selected, so a
 * page can render each tier card and addon price without a client fetch.
 */
export const getCoworkDateAdvertisedPriceRequests = (
  input: CoworkDateAdvertisedPriceInput
) =>
  getCoworkTierAdvertisedPriceRequests({
    ...input,
    offers: [
      { entryTier: "open-space", coffee: false },
      { entryTier: "open-space", coffee: true },
      ...reservedDeskAdvertisedOffers,
    ],
  });

export const getCoworkCoffeeAdvertisedPriceRequest = ({
  date,
  locale,
  submittedCode,
  tier,
}: {
  readonly date: string;
  readonly locale: Locale;
  readonly submittedCode?: CanonicalPromotionCode;
  readonly tier: WorkspaceCoworkCurrentTier;
}): CoworkAdvertisedPriceRequest => ({
  locale,
  ...(submittedCode && { submittedCode }),
  reservation: getCoworkAdvertisedPriceReservation({
    entryTier: tier,
    coffee: true,
    date,
  }),
});

/** Each tier option shows its tier's product line's advertised amount. */
export const coworkTierOptions: AdvertisedOptionFamily<
  CoworkAdvertisedPriceRequest,
  CoworkAdvertisedPrice
> = {
  isPrice: isCoworkAdvertisedPrice,
  amountOf: (price, { reservation: { details } }) =>
    getAdvertisedProductAmount(price, {
      kind: "cowork",
      tier: details.entryTier,
    }),
};

/**
 * The price a tier card shows: the first price loaded for one of the tier's
 * requests. Both Reserved Desk variants carry the same base product price.
 */
export const getCoworkTierOptionPrice = (
  prices: AdvertisedOptionPrices<
    CoworkAdvertisedPriceRequest,
    CoworkAdvertisedPrice
  >,
  tier: WorkspaceCoworkCurrentTier
) =>
  prices.requests
    .filter(({ reservation: { details } }) => details.entryTier === tier)
    .map((request) => prices.of(request))
    .find((price) => price !== undefined);

/**
 * The request priced for a tier selection. A Reserved Desk selection with a
 * workstation is priced by the workstation variant; Open Space has one.
 */
export const findCoworkAdvertisedPriceRequest = (
  requests: ReadonlyArray<CoworkAdvertisedPriceRequest>,
  selection: {
    readonly entryTier: WorkspaceCoworkProductTier;
    readonly workstation: boolean;
  }
) =>
  requests.find(({ reservation }) =>
    Match.value(reservation.details).pipe(
      Match.when(
        { entryTier: "open-space" },
        () => selection.entryTier === "open-space"
      ),
      Match.when(
        { entryTier: "reserved-desk" },
        ({ workstation }) =>
          selection.entryTier === "reserved-desk" &&
          workstation === selection.workstation
      ),
      Match.when({ entryTier: "basic" }, () => false),
      Match.when({ entryTier: "plus" }, () => false),
      Match.when({ entryTier: "profi" }, () => false),
      Match.exhaustive
    )
  );

/** The add-on line's amount in a cowork price. */
export const getCoworkAddOnAmount = (
  price: CoworkAdvertisedPrice | undefined,
  type: "coffee" | "workstation"
) => price?.quote.items.find((item) => item.type === type)?.amount;
