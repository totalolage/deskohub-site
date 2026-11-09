import type { Locale } from "@/features/i18n";
import {
  formatReferralDiscount,
  formatReferralDiscountReduction,
} from "@/features/referrals/client";
import { formatReferrerDiscountPercentage } from "@/features/referrals/referrer-discount";
import { accountSectionLandmarks } from "./account-sections";

/**
 * Browser expression that holds once the referrals screen shows the expected
 * eligible count, total, and rounded-up discount, and the Referrals navigation
 * badge shows the matching reduction (absent at 0%). Both the Playwright
 * account lane and the account case runner wait on it, so they check the
 * same stable ids instead of copy.
 */
export const referralStatsCondition = ({
  count,
  locale,
  savings,
  total,
}: {
  readonly count: number;
  readonly locale: Locale;
  readonly savings?: "empty" | "saved";
  readonly total?: number;
}) => {
  const discount = formatReferrerDiscountPercentage(count);
  const expected = {
    badge:
      count === 0 ? null : formatReferralDiscountReduction(discount, locale),
    discount: formatReferralDiscount(discount, locale),
    eligible: String(count),
    savings: savings ?? null,
    total: total === undefined ? null : `/ ${total}`,
  };
  return `((expected) => {
    const screen = document.querySelector(${JSON.stringify(accountSectionLandmarks.referrals)});
    const text = (selector) => screen?.querySelector(selector)?.textContent ?? null;
    const badge = document.querySelector('[data-account-navigation-badge="referrals"] [aria-hidden="true"]');
    return text("#account-referrals-eligible-count") === expected.eligible &&
      (expected.total === null || text("#account-referrals-total-count") === expected.total) &&
      text("#account-referrals-discount") === expected.discount &&
      (badge?.textContent ?? null) === expected.badge &&
      (expected.savings === null ||
        screen?.querySelector("#account-referrals-savings")?.getAttribute("data-state") === expected.savings);
  })(${JSON.stringify(expected)})`;
};
