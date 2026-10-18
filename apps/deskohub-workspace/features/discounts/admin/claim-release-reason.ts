import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

// A claim's release reason is the failure code of the payment attempt that
// released it. The column is free text, so an unknown code gets generic copy.
const claimReleaseReasonMessages: Partial<
  Record<string, typeof m.discountsClaimReleaseReasonOther>
> = {
  admin_forced_payment_cancellation:
    m.discountsClaimReleaseReasonAdministratorCancelledPayment,
  nexi_hpp_create_failed: m.discountsClaimReleaseReasonPaymentPageFailed,
  nexi_hpp_create_unconfirmed:
    m.discountsClaimReleaseReasonPaymentPageUnconfirmed,
  nexi_payment_failed: m.discountsClaimReleaseReasonPaymentFailed,
  payment_abandoned_after_provider_cutoff:
    m.discountsClaimReleaseReasonPaymentAbandoned,
};

/** Administration copy for why a discount claim was released. */
export const getClaimReleaseReasonLabel = (reason: string, locale: Locale) =>
  (claimReleaseReasonMessages[reason] ?? m.discountsClaimReleaseReasonOther)(
    {},
    { locale }
  );
