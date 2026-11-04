import type {
  AppliedDiscount,
  Discount,
  DiscountAdjustment,
} from "@/features/discounts/contracts";
import { deriveOpaqueDiscountId } from "@/features/discounts/opaque-discount-id";
import type { PromotionCodeId } from "@/features/discounts/persistence-contracts";
import type { getPromotionTiming } from "@/features/discounts/promotion-code";
import type { DiscountClaimInstruction } from "@/features/discounts/provider";
import { type Locale, m } from "@/features/i18n";
import {
  getReferralInvitationLabel,
  recognizeReferralBenefit,
} from "@/features/referrals/referral-benefits";
import { type Money, moneyEquals } from "@/shared/money/money";

// Compares the benefit a payment attempt accepted with what its claim may
// still grant, so claim admission refuses a benefit that changed meanwhile.

type ReferralInvitationClaim = Extract<
  DiscountClaimInstruction,
  { readonly kind: "referral_invitation" }
>;

type VoucherClaim = Extract<
  DiscountClaimInstruction,
  { readonly kind: "voucher" }
>;

type PromotionTiming = ReturnType<typeof getPromotionTiming>;

export const discountAdjustmentsEqual = (
  left: DiscountAdjustment,
  right: DiscountAdjustment
) => {
  if (left.kind !== right.kind) return false;
  if (left.kind === "percentage" && right.kind === "percentage") {
    return left.basisPoints === right.basisPoints;
  }
  if (left.kind === "fixed" && right.kind === "fixed") {
    return moneyEquals(left.amount, right.amount);
  }
  return false;
};

/** Whether the accepted discount's deadline differs from the promotion's. */
export const promotionTimingChanged = (
  timing: PromotionTiming,
  discount: Discount
) =>
  timing.expiresAt !== discount.expiresAt ||
  timing.countdownStartsAt !== discount.countdownStartsAt;

/** Whether an attribution recorded since pricing names another referral. */
export const isAttributedToAnotherReferral = (
  attribution:
    | {
        readonly referrerDotyposCustomerId: string;
        readonly promotionCodeId: PromotionCodeId | null;
      }
    | undefined,
  claim: ReferralInvitationClaim
) =>
  attribution !== undefined &&
  (attribution.referrerDotyposCustomerId !== claim.referrerDotyposCustomerId ||
    attribution.promotionCodeId !== claim.promotionCodeId);

/**
 * Whether the accepted invitation is no longer the invited customer's own
 * positive 15% invitation discount from another customer.
 */
export const referralInvitationBenefitChanged = (input: {
  readonly claim: ReferralInvitationClaim;
  readonly application: AppliedDiscount;
  readonly locale: Locale;
}) => {
  const recognition = recognizeReferralBenefit({
    dotyposCustomerId: input.claim.invitedDotyposCustomerId,
    discount: input.application.discount,
  });
  return (
    input.claim.invitedDotyposCustomerId ===
      input.claim.referrerDotyposCustomerId ||
    recognition.kind !== "invitation" ||
    !recognition.offersProgramRate ||
    input.application.discount.label !==
      getReferralInvitationLabel(input.locale) ||
    input.application.amount.value <= 0
  );
};

/**
 * Whether the voucher's available credit differs from the accepted credit,
 * or the application takes more than is available.
 */
export const voucherCreditChanged = (input: {
  readonly claim: VoucherClaim;
  readonly application: AppliedDiscount;
  readonly availableAmount: Money;
}) => {
  const adjustment = input.application.discount.adjustment;
  return (
    !moneyEquals(input.availableAmount, input.claim.availableAmount) ||
    adjustment.kind !== "fixed" ||
    !moneyEquals(adjustment.amount, input.availableAmount) ||
    input.application.amount.value > input.availableAmount.value
  );
};

/** Whether the accepted voucher discount no longer presents this voucher. */
export const voucherPresentationChanged = (input: {
  readonly claim: VoucherClaim;
  readonly application: AppliedDiscount;
  readonly locale: Locale;
  readonly timing: PromotionTiming;
}) =>
  input.application.discount.id !==
    deriveOpaqueDiscountId({
      providerNamespace: "database-voucher",
      providerReference: input.claim.voucherId,
    }) ||
  input.application.discount.label !==
    m.checkoutVoucherLabel({}, { locale: input.locale }) ||
  promotionTimingChanged(input.timing, input.application.discount);
