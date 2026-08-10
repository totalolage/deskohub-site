import { Match } from "effect";
import type { CheckoutCoworkStatusSummary } from "@/features/checkout/backend/checkout";
import type { CheckoutStatusSummaryPresentation } from "@/features/checkout/checkout-status-summary-presentation";
import {
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { formatReservationDisplayDate } from "@/features/reservation/reservation-date";

export const getCoworkCheckoutStatusSummary = (
  summary: CheckoutCoworkStatusSummary,
  locale: Locale
): CheckoutStatusSummaryPresentation => ({
  reservationTitle: getWorkspaceProductTierTitle(summary.entryTier, locale),
  rows: [
    {
      label: String(m.checkoutStatusSummaryTierLabel({}, { locale })),
      value: getWorkspaceProductTierTitle(summary.entryTier, locale),
    },
    {
      label: String(m.checkoutStatusSummaryDateLabel({}, { locale })),
      value: formatReservationDisplayDate(summary.reservedFrom, locale),
    },
    ...(summary.coffee
      ? [
          {
            label: String(m.checkoutStatusSummaryCoffeeLabel({}, { locale })),
            value: m.checkoutStatusYes({}, { locale }),
          },
        ]
      : []),
    ...Match.value(summary).pipe(
      Match.discriminatorsExhaustive("entryTier")({
        basic: () => [],
        plus: () => [],
        profi: ({ monitorOption }) => [
          {
            label: String(m.checkoutStatusSummaryMonitorLabel({}, { locale })),
            value: getWorkspaceProductMonitorTitle(monitorOption, locale),
          },
        ],
      })
    ),
    {
      label: String(m.checkoutStatusSummaryPriceLabel({}, { locale })),
      value: formatWorkspaceMoney(summary.price, locale),
    },
  ],
});
