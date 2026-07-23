import { Effect, Schema } from "effect";
import {
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  workspaceCoworkProductTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  addWorkspaceMoney,
  workspaceMoneyCodec,
} from "@/features/checkout/workspace-money";
import type { DiscountQuote } from "@/features/discounts";
import type { CoworkReservationDetails } from "@/features/reservation/cowork-reservation";
import {
  getReservationProductCoffee,
  getReservationProductMonitorOption,
} from "@/features/reservation/reservation-order";

const coworkProductQuoteItemSchema = Schema.Struct({
  type: Schema.Literal("cowork"),
  tier: Schema.Literals(workspaceCoworkProductTiers),
  amount: workspaceMoneyCodec,
});

const coworkCoffeeQuoteItemSchema = Schema.Struct({
  type: Schema.Literal("coffee"),
  amount: workspaceMoneyCodec,
});

const coworkMonitorQuoteItemSchema = Schema.Struct({
  type: Schema.Literal("monitor"),
  monitorOption: Schema.Literals(workspaceProductMonitorOptions),
  amount: workspaceMoneyCodec,
});

export const coworkReservationQuoteItemSchema = Schema.Union([
  coworkProductQuoteItemSchema,
  coworkCoffeeQuoteItemSchema,
  coworkMonitorQuoteItemSchema,
]);

type CoworkProductQuoteItem = typeof coworkProductQuoteItemSchema.Type;
type CoworkCoffeeQuoteItem = typeof coworkCoffeeQuoteItemSchema.Type;
type CoworkMonitorQuoteItem = typeof coworkMonitorQuoteItemSchema.Type;
type CoworkAddonQuoteItem = CoworkCoffeeQuoteItem | CoworkMonitorQuoteItem;

export type CoworkReservationQuoteItem =
  typeof coworkReservationQuoteItemSchema.Type;

export type CanonicalCoworkReservation = {
  readonly kind: "cowork";
};

export const getCoworkReservationQuote = Effect.fn("getCoworkReservationQuote")(
  function* (
    reservation: CoworkReservationDetails,
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
    const addonItems: CoworkAddonQuoteItem[] = [];

    if (getReservationProductCoffee(reservation)) {
      addonItems.push({
        type: "coffee",
        amount: getWorkspaceProductCoffeeLinePriceForTier(
          reservation.entryTier
        ),
      });
    }

    const monitorOption = getReservationProductMonitorOption(reservation);
    if (monitorOption) {
      addonItems.push({
        type: "monitor",
        monitorOption,
        amount: { ...productPrice, value: 0 },
      });
    }

    const items: CoworkReservationQuoteItem[] = [productItem, ...addonItems];
    const undiscountedPrice = yield* addWorkspaceMoney(
      items.map((item) => item.amount)
    );
    const discounts = options.discountQuote?.discounts ?? [];
    const discountedProductPrice =
      options.discountQuote?.discountedSubtotal ?? productPrice;
    const expectedPrice = yield* addWorkspaceMoney([
      discountedProductPrice,
      ...addonItems.map((item) => item.amount),
    ]);

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

export const getCanonicalCoworkReservation = (
  reservation: CoworkReservationDetails
): CanonicalCoworkReservation => ({
  kind: reservation.kind,
});
