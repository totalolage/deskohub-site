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
  discountAdvertisementQuoteCodec,
  discountProductIdentitySchema,
  discountQuoteCodec,
  isAppliedDiscount,
} from "./contracts";
export {
  type ApplyCustomerDiscountInput,
  type DiscountAdvertisementAffirmationInput,
  type DiscountPaymentAffirmation,
  type DiscountPaymentAffirmationInput,
  DiscountService,
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
