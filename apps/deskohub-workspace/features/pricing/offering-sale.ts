import type { PublicPriceListOffering } from "@/features/checkout/public-offerings";
import type { Locale } from "@/features/i18n";
import { formatMoney, moneyWithValue } from "@/shared/money/money";

/**
 * The sale on the offering's smallest booking, formatted for `locale`, when
 * one runs today.
 */
export const getOfferingSale = (
  { advertisedPrice }: PublicPriceListOffering,
  locale: Locale
) =>
  advertisedPrice && advertisedPrice.discount.value > 0
    ? {
        price: formatMoney(advertisedPrice.price, locale),
        regularPrice: formatMoney(
          moneyWithValue(
            advertisedPrice.price.value + advertisedPrice.discount.value,
            advertisedPrice.price
          ),
          locale
        ),
      }
    : undefined;
