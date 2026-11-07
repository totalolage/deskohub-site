import { releaseGateForRun } from "@/features/feature-flags/backend/release-gate-run";
import {
  ReferralReleaseGate,
  referralReleaseRunPolicy,
} from "./referral-release-gate";

/**
 * The referral gate decided once per build, for a request served outside
 * Next.js, such as the customer HTTP API. Build it once per request.
 */
export const ReferralReleaseGateForRun = releaseGateForRun(
  ReferralReleaseGate,
  referralReleaseRunPolicy
);
