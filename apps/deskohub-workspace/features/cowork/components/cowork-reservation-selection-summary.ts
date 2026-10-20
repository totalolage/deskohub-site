import type { CheckoutStatusSummaryPresentation } from "@/features/checkout/checkout-status-summary-presentation";
import type {
  WorkspaceCoworkProductTier,
  WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { formatReservationDisplayPlainDate } from "@/features/reservation/reservation-date";

/** The cowork selection as the contact-details step summarizes it. */
export const getCoworkReservationSelectionSummary = (
  selection: {
    readonly entryTier: WorkspaceCoworkProductTier;
    readonly date: string;
    readonly coffee?: boolean;
    /** Empty while no workstation is picked. */
    readonly monitorOption?: WorkspaceProductMonitorOption | "";
  },
  locale: Locale
): CheckoutStatusSummaryPresentation => ({
  reservationTitle: getWorkspaceProductTierTitle(selection.entryTier, locale),
  rows: [
    ...(selection.date
      ? [
          {
            label: m.checkoutStatusSummaryDateLabel({}, { locale }),
            value: formatReservationDisplayPlainDate(
              Temporal.PlainDate.from(selection.date),
              locale
            ),
          },
        ]
      : []),
    ...(selection.coffee
      ? [
          {
            label: m.checkoutStatusSummaryCoffeeLabel({}, { locale }),
            value: m.checkoutStatusYes({}, { locale }),
          },
        ]
      : []),
    ...(selection.monitorOption
      ? [
          {
            label: m.checkoutStatusSummaryMonitorLabel({}, { locale }),
            value: getWorkspaceProductMonitorTitle(
              selection.monitorOption,
              locale
            ),
          },
        ]
      : []),
  ],
});
