export type { DiscountCommitment } from "./commitment";
export {
  type AppliedDiscount,
  appliedDiscountCodec,
  type CanonicalDiscountCode,
  canonicalDiscountCodeSchema,
  type Discount,
  type DiscountAdjustment,
  type DiscountId,
  type DiscountQuote,
  type DiscountQuoteInput,
  discountProductIdentitySchema,
  isAppliedDiscount,
} from "./contracts";
export {
  type DiscountRevalidation,
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
