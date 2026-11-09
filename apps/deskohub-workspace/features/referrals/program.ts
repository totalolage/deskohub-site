/**
 * Referral program terms. Pricing, eligibility, and the account explanation
 * all read them from here.
 */

/** First-booking discount for an invited customer. */
export const referralInvitationDiscountBasisPoints = 1_500;

/** Compounding discount each currently eligible invitee earns the referrer. */
export const referrerDiscountBasisPointsPerInvitee = 500;

/** How long after an invitee's paid visit ends it counts toward the referrer. */
export const referralVisitWindowDays = 30;

/** How long a browser remembers the referral code a shared link carried. */
export const sharedReferralCodeRememberedDays = 30;

/** Share of the price the account explanation uses as a milestone. */
export const referralDiscountBenchmark = 0.2;

/** Fewest eligible invitees whose compounded discount passes the benchmark. */
export const referralsToPassBenchmark = Math.ceil(
  Math.log(1 - referralDiscountBenchmark) /
    Math.log(1 - referrerDiscountBasisPointsPerInvitee / 10_000)
);
