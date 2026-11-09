import "server-only";

import { releaseGateForRequest } from "@/features/feature-flags/backend/release-gate.server";
import {
  ReferralReleaseGate,
  referralReleaseRunPolicy,
} from "./referral-release-gate";

const referralRequest = releaseGateForRequest(ReferralReleaseGate, {
  operation: "referrals.enabled",
  ...referralReleaseRunPolicy,
});

/** Whether the referral program is released for this request. */
export const areReferralsEnabled = referralRequest.isOpen;

/** The referral gate backed by the request's one decision. */
export const ReferralReleaseGateRequest = referralRequest.layer;
