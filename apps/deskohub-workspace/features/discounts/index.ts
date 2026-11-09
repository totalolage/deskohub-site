export type { DiscountCommitment } from "./commitment";
export {
  type ActiveSale,
  type AffirmedDiscountAdvertisementQuote,
  type AppliedDiscount,
  affirmedDiscountAdvertisementQuoteCodec,
  type CanonicalPromotionCode,
  canonicalPromotionCodeSchema,
  type DiscountAdvertisementInput,
  type DiscountAdvertisementQuote,
  type DiscountId,
  type DiscountQuote,
  discountAdvertisementQuoteCodec,
  discountIdSchema,
} from "./contracts";
export { DiscountService } from "./discount.service";
export {
  DiscountAffirmationUnavailableError,
  DiscountProviderError,
  type DiscountResolutionError,
  PromotionCodeUnavailableError,
} from "./errors";
export {
  discountCodeQueryParam,
  normalizeSubmittedPromotionCode,
} from "./promotion-code";
