import { Data } from "effect";
import type { DiscountId } from "./contracts";
import type { DiscountCodeId } from "./persistence-contracts";

export type DiscountCalculationFailureReason =
  | "invalid_discountable_subtotal"
  | "currency_mismatch"
  | "exponent_mismatch";

export class DiscountCalculationError extends Data.TaggedError(
  "DiscountCalculationError"
)<{
  readonly reason: DiscountCalculationFailureReason;
  readonly message: string;
  readonly discountId?: DiscountId;
  readonly cause?: unknown;
}> {}

export type DiscountCodeUnavailableReason =
  | "invalid_syntax"
  | "feature_disabled"
  | "unknown_code"
  | "inactive"
  | "not_started"
  | "expired"
  | "usage_limit_reached"
  | "already_redeemed"
  | "customer_ineligible"
  | "product_ineligible"
  | "no_eligible_subtotal";

export class DiscountCodeUnavailableError extends Data.TaggedError(
  "DiscountCodeUnavailableError"
)<{
  readonly reason: DiscountCodeUnavailableReason;
  readonly message: string;
  readonly codeId?: DiscountCodeId;
  readonly cause?: unknown;
}> {}

export type DiscountProviderFailureReason =
  | "malformed_configuration"
  | "provider_failure";

export class DiscountProviderError extends Data.TaggedError(
  "DiscountProviderError"
)<{
  readonly reason: DiscountProviderFailureReason;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DiscountClaimConflictError extends Data.TaggedError(
  "DiscountClaimConflictError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type DiscountResolutionError =
  | DiscountCalculationError
  | DiscountCodeUnavailableError
  | DiscountProviderError;

export type DiscountError =
  | DiscountClaimConflictError
  | DiscountResolutionError;
