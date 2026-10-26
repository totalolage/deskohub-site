import "server-only";

import { GlobalReleaseGate } from "@/features/feature-flags/components/global-release-gate";
import { areReferralsEnabled } from "./referral-feature-flag.server";
import { RememberSharedReferralCode } from "./remember-shared-referral-code";

/**
 * Mounts {@link RememberSharedReferralCode} only while the referral program is
 * enabled.
 */
export function RememberSharedReferralCodeWhenEnabled() {
  return (
    <GlobalReleaseGate flag="referrals" isEnabled={areReferralsEnabled}>
      <RememberSharedReferralCode />
    </GlobalReleaseGate>
  );
}
