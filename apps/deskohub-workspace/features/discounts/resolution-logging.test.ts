import { expect, test } from "bun:test";
import type { logDiscountResolutionFailure } from "./resolution-logging";

type DiscountResolutionFailureTag = Parameters<
  typeof logDiscountResolutionFailure
>[0]["cause"]["_tag"];

type ExpectedDiscountResolutionFailureTag =
  | "CalendarSaleConfigurationError"
  | "DiscountCalculationError"
  | "DiscountCodeUnavailableError"
  | "DiscountProviderError";

type IsExact<Actual, Expected> = [Actual] extends [Expected]
  ? [Expected] extends [Actual]
    ? true
    : false
  : false;

const hasExactFailureTags: IsExact<
  DiscountResolutionFailureTag,
  ExpectedDiscountResolutionFailureTag
> = true;

test("keeps discount resolution failure tags discriminated", () => {
  expect(hasExactFailureTags).toBe(true);
});
