import { expect, test } from "bun:test";
import {
  formatPricingPolicyDates,
  isLegacyPricingActive,
  PRICING_POLICY_CUTOVER_AT,
} from "./pricing-policy";

test("keeps the legacy pricing announcement before Prague midnight", () => {
  expect(isLegacyPricingActive(PRICING_POLICY_CUTOVER_AT - 1)).toBeTrue();
});

test("shows only the new pricing from September 1, 2026", () => {
  expect(isLegacyPricingActive(PRICING_POLICY_CUTOVER_AT)).toBeFalse();
});

test.each([
  [
    "en-US",
    {
      legacyEndDate: "August 31, 2026",
      newPolicyStartDate: "September 1, 2026",
    },
  ],
  [
    "cs-CZ",
    {
      legacyEndDate: "31. srpna 2026",
      newPolicyStartDate: "1. září 2026",
    },
  ],
] as const)("formats pricing policy dates for %s", (locale, expected) => {
  expect(formatPricingPolicyDates(locale)).toEqual(expected);
});
