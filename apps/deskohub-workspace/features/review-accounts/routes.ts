import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

/** Where a review account's Pay link leads instead of the payment page. */
export const reviewPaymentDisabledPath = "/reservation/payment-disabled";

export const getReviewPaymentDisabledPath = (
  locale: Locale,
  orderId: WorkspaceReservationId
) => `/${locale}${reviewPaymentDisabledPath}/${encodeURIComponent(orderId)}`;
