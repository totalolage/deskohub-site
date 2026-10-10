import type { DotyposCustomerId } from "@deskohub/dotypos";
import { deriveOpaqueDiscountId } from "@/features/discounts/opaque-discount-id";

export const getReferralInvitationDiscountId = (
  dotyposCustomerId: DotyposCustomerId
) =>
  deriveOpaqueDiscountId({
    providerNamespace: "referral-invitation",
    providerReference: dotyposCustomerId,
  });

export const getReferralReferrerDiscountId = (
  dotyposCustomerId: DotyposCustomerId
) =>
  deriveOpaqueDiscountId({
    providerNamespace: "referral-referrer",
    providerReference: dotyposCustomerId,
  });

export const getReferralDiscountIds = (dotyposCustomerId: DotyposCustomerId) =>
  new Set([
    getReferralInvitationDiscountId(dotyposCustomerId),
    getReferralReferrerDiscountId(dotyposCustomerId),
  ]);
