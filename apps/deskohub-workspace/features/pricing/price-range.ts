import { Array as Arr, Order } from "effect";
import { getPublicCatalogOfferings } from "@/features/checkout/public-offerings";
import type { Locale } from "@/features/i18n";
import { formatMoney, moneyMajorAmount } from "@/shared/money/money";

const byAmount = Order.mapInput(Order.Number, moneyMajorAmount);

/**
 * The lowest to the highest regular price of the products every visitor can
 * book, as the price list shows them. Sales and gated products are left out.
 */
export const getCatalogPriceRange = (locale: Locale): string | undefined => {
  const prices = getPublicCatalogOfferings({ locale }).map(
    ({ price }) => price
  );
  if (!Arr.isReadonlyArrayNonEmpty(prices)) return undefined;

  return [Arr.min(prices, byAmount), Arr.max(prices, byAmount)]
    .map((price) => formatMoney(price, locale))
    .join(" – ");
};
