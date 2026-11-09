import type { logDiscountResolutionFailure } from "./resolution-logging";

type AssertTrue<Value extends true> = Value;

type IsExact<Actual, Expected> = [Actual] extends [Expected]
  ? [Expected] extends [Actual]
    ? true
    : false
  : false;

// Failure logging stays discriminated by each discount resolution error tag.
export type DiscountResolutionFailureTagsStayExact = AssertTrue<
  IsExact<
    Parameters<typeof logDiscountResolutionFailure>[0]["cause"]["_tag"],
    | "CalendarSaleConfigurationError"
    | "EffectDrizzleQueryError"
    | "SqlError"
    | "DotyposUnavailable"
    | "DotyposRejected"
    | "DiscountCalculationError"
    | "PromotionCodeUnavailableError"
    | "DiscountProviderError"
  >
>;
