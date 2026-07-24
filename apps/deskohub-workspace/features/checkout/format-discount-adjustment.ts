import { Match } from "effect";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import { formatWorkspaceMoney } from "./workspace-money";

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
      fixed: ({ amount }) => formatWorkspaceMoney(amount, locale),
    })
  );
