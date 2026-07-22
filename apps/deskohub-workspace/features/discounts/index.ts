export type { DiscountCommitment } from "./commitment";
export {
  type AffirmedDiscountAdvertisementQuote,
  type AppliedDiscount,
  affirmedDiscountAdvertisementQuoteCodec,
  appliedDiscountCodec,
  type CanonicalDiscountCode,
  canonicalDiscountCodeSchema,
  type Discount,
  type DiscountAdjustment,
  type DiscountAdvertisementInput,
  type DiscountAdvertisementQuote,
  type DiscountId,
  type DiscountQuote,
  type DiscountQuoteInput,
  discountAdvertisementQuoteCodec,
  discountProductIdentitySchema,
  discountQuoteCodec,
  isAppliedDiscount,
} from "./contracts";
export {
  type ApplyCustomerDiscountInput,
  type ApplyDiscountCodeInput,
  type DiscountAdvertisementAffirmationInput,
  DiscountService,
  type DisplayedDiscountAffirmation,
  type DisplayedDiscountAffirmationInput,
  type IDiscountService,
} from "./discount.service";
export { normalizeSubmittedDiscountCode } from "./discount-code";
export {
  DiscountCalculationError,
  type DiscountCalculationFailureReason,
  DiscountClaimConflictError,
  DiscountCodeUnavailableError,
  type DiscountCodeUnavailableReason,
  type DiscountError,
  DiscountProviderError,
  type DiscountProviderFailureReason,
  type DiscountResolutionError,
} from "./errors";
