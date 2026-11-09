import { Effect, Schema } from "effect";
import {
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkTiers,
  workspaceProductWorkstationAddonPrice,
} from "@/features/checkout/product-catalog";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { makeReservationQuoteSchema } from "@/features/checkout/reservation-quote-schema";
import type { DiscountQuote } from "@/features/discounts";
import { moneyCodec, sumMoney } from "@/shared/money/money";

const coworkProductQuoteItemSchema = Schema.Struct({
  type: Schema.Literal("cowork"),
  tier: Schema.Literals(workspaceCoworkTiers),
  amount: moneyCodec,
});

const coworkCoffeeQuoteItemSchema = Schema.Struct({
  type: Schema.Literal("coffee"),
  amount: moneyCodec,
});

const coworkWorkstationQuoteItemSchema = Schema.Struct({
  type: Schema.Literal("workstation"),
  amount: moneyCodec,
});

export const coworkReservationQuoteItemSchema = Schema.Union([
  coworkProductQuoteItemSchema,
  coworkCoffeeQuoteItemSchema,
  coworkWorkstationQuoteItemSchema,
]);

type CoworkProductQuoteItem = typeof coworkProductQuoteItemSchema.Type;
type CoworkCoffeeQuoteItem = typeof coworkCoffeeQuoteItemSchema.Type;
type CoworkWorkstationQuoteItem = typeof coworkWorkstationQuoteItemSchema.Type;

export const coworkReservationQuoteSchema = makeReservationQuoteSchema(
  Schema.Union([
    Schema.Tuple([coworkProductQuoteItemSchema]),
    Schema.Tuple([coworkProductQuoteItemSchema, coworkCoffeeQuoteItemSchema]),
    Schema.Tuple([
      coworkProductQuoteItemSchema,
      coworkWorkstationQuoteItemSchema,
    ]),
  ])
).annotate({
  identifier: "CoworkReservationQuote",
  description: "Authoritative cowork reservation price quote.",
});

export type CoworkReservationQuote = typeof coworkReservationQuoteSchema.Type;

export type CanonicalCoworkReservation = {
  readonly kind: "cowork";
};

/**
 * Accepts every cowork selection shape that reaches a pricing boundary:
 * advertised-price details (workstation presence), normalized orders, and
 * stored details projections (monitor configuration). The canonical cowork
 * `kind` discriminator is mandatory so the input forwards truthfully into
 * the exhaustive cross-family fingerprint dispatch. The chosen monitor
 * configuration never enters the priced quote items.
 */
export type CoworkReservationQuoteInput = {
  readonly kind: "cowork";
  readonly entryTier: WorkspaceCoworkProductTier;
  readonly coffee?: boolean;
  readonly workstation?: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption | "" | undefined;
};

type CoworkAddonQuoteItem = CoworkCoffeeQuoteItem | CoworkWorkstationQuoteItem;

type CoworkQuoteItems =
  | readonly [CoworkProductQuoteItem]
  | readonly [CoworkProductQuoteItem, CoworkCoffeeQuoteItem]
  | readonly [CoworkProductQuoteItem, CoworkWorkstationQuoteItem];

/**
 * Workstation presence is truthful: an empty or absent monitor option means
 * no workstation was selected, so only an explicit workstation flag or a
 * real, present monitor selection prices the paid add-on.
 */
const getCoworkReservationWorkstationSelected = (
  reservation: CoworkReservationQuoteInput
) =>
  reservation.workstation ??
  (reservation.monitorOption !== undefined && reservation.monitorOption !== "");

const getCoworkCoffeeQuoteItem = (
  tier: WorkspaceCoworkProductTier
): CoworkCoffeeQuoteItem => ({
  type: "coffee",
  amount: getWorkspaceProductCoffeeLinePriceForTier(tier),
});

/**
 * The paid add-on each tier prices. Current tiers price coffee (open space)
 * or a workstation (reserved desk) when selected. Historical tiers keep
 * their original addon composition for decodable legacy quotes: Basic paid
 * for coffee when selected, Plus and Profi had it included.
 */
const coworkAddonQuoteItemByTier: Readonly<
  Record<
    WorkspaceCoworkProductTier,
    (
      reservation: CoworkReservationQuoteInput
    ) => CoworkAddonQuoteItem | undefined
  >
> = {
  "open-space": (reservation) =>
    reservation.coffee ? getCoworkCoffeeQuoteItem("open-space") : undefined,
  "reserved-desk": (reservation) =>
    getCoworkReservationWorkstationSelected(reservation)
      ? { type: "workstation", amount: workspaceProductWorkstationAddonPrice }
      : undefined,
  basic: (reservation) =>
    reservation.coffee ? getCoworkCoffeeQuoteItem("basic") : undefined,
  plus: () => getCoworkCoffeeQuoteItem("plus"),
  profi: () => getCoworkCoffeeQuoteItem("profi"),
};

const getCoworkQuoteItems = (
  productItem: CoworkProductQuoteItem,
  addonItem: CoworkAddonQuoteItem | undefined
): CoworkQuoteItems => {
  if (addonItem === undefined) return [productItem];
  return addonItem.type === "coffee"
    ? [productItem, addonItem]
    : [productItem, addonItem];
};

export const getCoworkReservationQuote = Effect.fn("getCoworkReservationQuote")(
  function* (
    reservation: CoworkReservationQuoteInput,
    options: {
      readonly discountQuote?: DiscountQuote;
    } = {}
  ) {
    const productPrice = getWorkspaceProductByTier(reservation.entryTier).price;
    const productItem: CoworkProductQuoteItem = {
      type: "cowork",
      tier: reservation.entryTier,
      amount: productPrice,
    };
    const addonItem =
      coworkAddonQuoteItemByTier[reservation.entryTier](reservation);
    const items = getCoworkQuoteItems(productItem, addonItem);
    const addonAmounts = addonItem ? [addonItem.amount] : [];
    const undiscountedPrice = yield* Effect.fromResult(
      sumMoney([productItem.amount, ...addonAmounts])
    );
    const discounts = options.discountQuote?.discounts ?? [];
    const discountedProductPrice =
      options.discountQuote?.discountedSubtotal ?? productPrice;
    const expectedPrice = yield* Effect.fromResult(
      sumMoney([discountedProductPrice, ...addonAmounts])
    );

    return {
      items,
      payment: {
        expectedPrice,
        undiscountedPrice,
        discounts,
      },
    };
  }
);

export const buildCoworkReservationQuote = Effect.fn(
  "buildCoworkReservationQuote"
)(function* (
  reservation: CoworkReservationQuoteInput,
  options: {
    readonly discountQuote?: DiscountQuote;
  } = {}
) {
  // The cross-family fingerprint dispatcher would silently accept another
  // family's kind while this builder still prices cowork items, so reject
  // any runtime kind other than "cowork" at this boundary.
  if (reservation.kind !== "cowork") {
    return yield* Effect.die(
      new Error("Cowork reservation quote requires the canonical cowork kind.")
    );
  }

  const quoteWithoutFingerprint = yield* getCoworkReservationQuote(
    reservation,
    options
  );

  return {
    ...quoteWithoutFingerprint,
    fingerprint: getReservationQuoteFingerprint(
      reservation,
      quoteWithoutFingerprint
    ),
  };
});
