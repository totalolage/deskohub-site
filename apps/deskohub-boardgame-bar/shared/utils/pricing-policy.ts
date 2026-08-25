import type { Locale } from "@/features/i18n";
import { formatDate } from "./date-formatting";

export const PRICING_POLICY_CUTOVER_AT = Date.UTC(2026, 7, 31, 22);

export const isLegacyPricingActive = (nowMs = Date.now()) =>
  nowMs < PRICING_POLICY_CUTOVER_AT;

export const formatPricingPolicyDates = (locale: Locale) => ({
  legacyEndDate: formatDate(new Date(PRICING_POLICY_CUTOVER_AT - 1), locale, {
    dateStyle: "long",
  }),
  newPolicyStartDate: formatDate(new Date(PRICING_POLICY_CUTOVER_AT), locale, {
    dateStyle: "long",
  }),
});
