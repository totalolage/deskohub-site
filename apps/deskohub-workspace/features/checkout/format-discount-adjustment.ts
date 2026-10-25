import { Match } from "effect";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import { formatMoney, moneyWithValue } from "@/shared/money/money";

export const formatDiscountAdjustment = (
  adjustment: DiscountAdjustment,
  locale: Locale
) =>
  Match.value(adjustment).pipe(
    Match.discriminatorsExhaustive("kind")({
      percentage: ({ basisPoints }) =>
        new Intl.NumberFormat(locale, {
          style: "percent",
          maximumFractionDigits: 2,
        }).format(basisPoints / 10_000),
      fixed: ({ amount }) => formatMoney(amount, locale),
    })
  );

/**
 * Formats the adjustment as the signed price change it causes, such as
 * "-20%" or "-CZK 50".
 */
export const formatDiscountReduction = (
  adjustment: DiscountAdjustment,
  locale: Locale
) =>
  formatDiscountAdjustment(
    Match.value(adjustment).pipe(
      Match.discriminatorsExhaustive("kind")({
        percentage: ({ basisPoints }): DiscountAdjustment => ({
          kind: "percentage",
          basisPoints: -basisPoints,
        }),
        fixed: ({ amount }): DiscountAdjustment => ({
          kind: "fixed",
          amount: moneyWithValue(-amount.value, amount),
        }),
      })
    ),
    locale
  );
