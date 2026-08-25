export const PRICING_POLICY_CUTOVER_AT = Date.UTC(2026, 7, 31, 22);

export const isLegacyPricingActive = (nowMs = Date.now()) =>
  nowMs < PRICING_POLICY_CUTOVER_AT;
