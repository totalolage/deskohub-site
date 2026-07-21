import { Effect } from "effect";
import type {
  WorkspaceAdvertisedPrice,
  WorkspaceAdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import {
  calculateWorkspaceCheckoutQuote,
  normalizeWorkspaceCheckoutOrder,
} from "@/features/checkout/checkout-quote";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import { withWorkspaceMoneyCurrency } from "@/features/checkout/workspace-money";
import { DiscountService } from "@/features/discounts";
import {
  buildAdvertisedPriceState,
  sealAdvertisedPriceState,
} from "./advertised-price-state";
import { getNexiCheckoutCurrencyOverride } from "./checkout.service";

export const buildWorkspaceAdvertisedPrice = Effect.fn(
  "buildWorkspaceAdvertisedPrice"
)(function* (input: WorkspaceAdvertisedPriceRequest) {
  const order = yield* normalizeWorkspaceCheckoutOrder(
    input.reservation.details
  );
  const currencyOverride = getNexiCheckoutCurrencyOverride();
  const product = getWorkspaceProductByTier(order.entryTier);
  const discountableSubtotal = withWorkspaceMoneyCurrency(
    product.price,
    currencyOverride
  );
  const discounts = yield* DiscountService;
  const discountQuote = yield* discounts.advertise({
    product: { kind: "cowork", tier: order.entryTier },
    discountableSubtotal,
    reservationDate: input.reservation.details.date,
    locale: input.locale,
  });
  const quote = yield* calculateWorkspaceCheckoutQuote(order, {
    discountQuote,
    currencyOverride,
  });
  const state = buildAdvertisedPriceState({
    locale: input.locale,
    reservation: input.reservation,
    quote,
  });

  return {
    quote,
    advertisedPriceToken: sealAdvertisedPriceState(state),
  } satisfies WorkspaceAdvertisedPrice;
});
