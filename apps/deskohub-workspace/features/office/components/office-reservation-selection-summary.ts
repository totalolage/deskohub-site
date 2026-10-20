import type { CheckoutStatusSummaryPresentation } from "@/features/checkout/checkout-status-summary-presentation";
import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { getOfficeReservationEndsOn } from "@/features/reservation/office-reservation";
import { formatReservationDisplayPlainDateRange } from "@/features/reservation/reservation-date";

/** The office selection as the contact-details step summarizes it. */
export const getOfficeReservationSelectionSummary = (
  selection: {
    readonly startsOn?: string;
    readonly dayCount?: number;
    readonly seats?: number;
  },
  locale: Locale
): CheckoutStatusSummaryPresentation => ({
  reservationTitle: getWorkspaceOfficeProductTitle(locale),
  rows: [
    ...(selection.startsOn && selection.dayCount
      ? [
          {
            label: m.checkoutStatusSummaryDateLabel({}, { locale }),
            value: formatReservationDisplayPlainDateRange(
              Temporal.PlainDate.from(selection.startsOn),
              Temporal.PlainDate.from(
                getOfficeReservationEndsOn({
                  startsOn: selection.startsOn,
                  dayCount: selection.dayCount,
                })
              ),
              locale
            ),
          },
        ]
      : []),
    ...(selection.seats
      ? [
          {
            label: m.checkoutStatusSummarySeatsLabel({}, { locale }),
            value: String(selection.seats),
          },
        ]
      : []),
  ],
});
