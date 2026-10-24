import type { CheckoutOfficeStatusSummary } from "@/features/checkout/backend/checkout";
import type { CheckoutStatusSummaryPresentation } from "@/features/checkout/checkout-status-summary-presentation";
import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { formatReservationDisplayDateRange } from "@/features/reservation/reservation-date";
import { formatMoney } from "@/shared/money/money";

export const getOfficeCheckoutStatusSummary = (
  summary: CheckoutOfficeStatusSummary,
  locale: Locale
): CheckoutStatusSummaryPresentation => ({
  reservationTitle: getWorkspaceOfficeProductTitle(locale),
  rows: [
    {
      label: String(m.checkoutStatusSummaryReservationLabel({}, { locale })),
      value: getWorkspaceOfficeProductTitle(locale),
    },
    {
      label: String(m.checkoutStatusSummaryDateLabel({}, { locale })),
      value: formatReservationDisplayDateRange(
        summary.reservedFrom,
        summary.reservedUntil,
        locale
      ),
    },
    {
      label: String(m.checkoutStatusSummarySeatsLabel({}, { locale })),
      value: String(summary.seats),
    },
    {
      label: String(m.checkoutStatusSummaryPriceLabel({}, { locale })),
      value: formatMoney(summary.price, locale),
    },
  ],
});
