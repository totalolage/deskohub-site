import { Effect } from "effect";
import {
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import {
  addWorkspaceMoney,
  type WorkspaceMoney,
  withWorkspaceMoneyCurrency,
} from "@/features/checkout/workspace-money";
import type { DiscountQuote } from "@/features/discounts";
import type { NormalizedCoworkReservationOrder } from "@/features/reservation/cowork-reservation";
import {
  getReservationProductCoffee,
  getReservationProductMonitorOption,
} from "@/features/reservation/reservation-order";

type CoworkReservation = NormalizedCoworkReservationOrder;

type CoworkProductQuoteItem = {
  readonly type: "cowork";
  readonly tier: WorkspaceCoworkProductTier;
  readonly amount: WorkspaceMoney;
};

type CoworkCoffeeQuoteItem = {
  readonly type: "coffee";
  readonly amount: WorkspaceMoney;
};

type CoworkMonitorQuoteItem = {
  readonly type: "monitor";
  readonly monitorOption: WorkspaceProductMonitorOption;
  readonly amount: WorkspaceMoney;
};

type CoworkAddonQuoteItem = CoworkCoffeeQuoteItem | CoworkMonitorQuoteItem;

export type CoworkReservationQuoteItem =
  | CoworkProductQuoteItem
  | CoworkAddonQuoteItem;

export type CanonicalCoworkReservation = {
  readonly kind: "cowork";
};

export const getCoworkReservationQuote = Effect.fn("getCoworkReservationQuote")(
  function* (
    reservation: CoworkReservation,
    options: {
      readonly discountQuote?: DiscountQuote;
      readonly currencyOverride?: string;
    } = {}
  ) {
    const productPrice = withWorkspaceMoneyCurrency(
      getWorkspaceProductByTier(reservation.entryTier).price,
      options.currencyOverride
    );
    const productItem: CoworkProductQuoteItem = {
      type: "cowork",
      tier: reservation.entryTier,
      amount: productPrice,
    };
    const addonItems: CoworkAddonQuoteItem[] = [];

    if (getReservationProductCoffee(reservation)) {
      addonItems.push({
        type: "coffee",
        amount: withWorkspaceMoneyCurrency(
          getWorkspaceProductCoffeeLinePriceForTier(reservation.entryTier),
          options.currencyOverride
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
  reservation: CoworkReservation
): CanonicalCoworkReservation => ({
  kind: reservation.kind,
});
