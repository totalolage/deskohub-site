import "server-only";

import { releaseGateForRequest } from "@/features/feature-flags/backend/release-gate.server";
import { ReferralReleaseGate } from "./referral-release-gate";

// Any run failure, including a defect or a runtime that cannot start,
// withholds the program.
const referralRequest = releaseGateForRequest(ReferralReleaseGate, {
  operation: "referrals.enabled",
  whenRunFails: "close",
  failureCode: "referral_feature_flag_unavailable",
});

/** Whether the referral program is released for this request. */
export const areReferralsEnabled = referralRequest.isOpen;

/** The referral gate backed by the request's one decision. */
export const ReferralReleaseGateRequest = referralRequest.layer;
