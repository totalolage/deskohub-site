import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { AppliedDiscount } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import { getReferralInvitationDiscountId } from "@/features/referrals/discount-identifiers";

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

export const hasCheckoutReferralAppliedNotice = ({
  marker,
  discounts,
  dotyposCustomerId,
}: {
  readonly marker: unknown;
  readonly discounts: readonly AppliedDiscount[];
  readonly dotyposCustomerId: DotyposCustomerId;
}) =>
  marker === checkoutReferralAppliedMarker &&
  discounts.some(
    ({ discount }) =>
      discount.id === getReferralInvitationDiscountId(dotyposCustomerId) &&
      discount.adjustment.kind === "percentage" &&
      discount.adjustment.basisPoints === 1_500
  );
