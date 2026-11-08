import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { AppliedDiscount } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import { recognizeReferralBenefit } from "@/features/referrals/referral-benefits";

export const checkoutReferralAppliedQueryParam = "referralApplied" as const;
const checkoutReferralAppliedMarker = "1";
const checkoutPayOrigin = "https://workspace-checkout.invalid";

export const addCheckoutReferralAppliedMarker = (
  freshPayUrl: string,
  locale: Locale
): string | undefined => {
  try {
    const url = new URL(freshPayUrl, checkoutPayOrigin);
    if (
      url.origin !== checkoutPayOrigin ||
      url.pathname !== `/${locale}/checkout/pay` ||
      url.searchParams.getAll("payState").length !== 1 ||
      !url.searchParams.get("payState")
    ) {
      return undefined;
    }

    url.searchParams.set(
      checkoutReferralAppliedQueryParam,
      checkoutReferralAppliedMarker
    );
    return `${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
};

/** Whether the discounts hold this customer's invitation at the program rate. */
export const hasCheckoutReferralBenefit = ({
  discounts,
  dotyposCustomerId,
}: {
  readonly discounts: readonly AppliedDiscount[];
  readonly dotyposCustomerId: DotyposCustomerId;
}) =>
  discounts.some(({ discount }) => {
    const recognition = recognizeReferralBenefit({
      dotyposCustomerId,
      discount,
    });
    return recognition.kind === "invitation" && recognition.offersProgramRate;
  });

export const hasCheckoutReferralAppliedNotice = ({
  marker,
  ...benefit
}: {
  readonly marker: unknown;
  readonly discounts: readonly AppliedDiscount[];
  readonly dotyposCustomerId: DotyposCustomerId;
}) =>
  marker === checkoutReferralAppliedMarker &&
  hasCheckoutReferralBenefit(benefit);
