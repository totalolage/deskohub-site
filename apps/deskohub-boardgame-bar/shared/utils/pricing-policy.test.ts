import { expect, test } from "bun:test";
import {
  isLegacyPricingActive,
  PRICING_POLICY_CUTOVER_AT,
} from "./pricing-policy";

test("keeps the legacy pricing announcement before Prague midnight", () => {
  expect(isLegacyPricingActive(PRICING_POLICY_CUTOVER_AT - 1)).toBeTrue();
});

test("shows only the new pricing from September 1, 2026", () => {
  expect(isLegacyPricingActive(PRICING_POLICY_CUTOVER_AT)).toBeFalse();
});
