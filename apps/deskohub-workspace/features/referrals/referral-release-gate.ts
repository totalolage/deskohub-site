import { ReleaseGate } from "@/features/feature-flags/backend/release-gate";
import type { ReleaseGateRunPolicy } from "@/features/feature-flags/backend/release-gate-run";

/**
 * `referrals`: the referral program. Next.js request code provides the
 * request's one decision (`ReferralReleaseGateRequest` in
 * `referral-release-gate.server.ts`), so pages, layouts, and services agree;
 * request code served outside Next.js provides `ReferralReleaseGateForRun`
 * (`referral-release-gate-run.ts`).
 */
export class ReferralReleaseGate extends ReleaseGate<ReferralReleaseGate>()(
  "@deskohub-workspace/referrals/ReferralReleaseGate",
  "referrals"
) {}

/**
 * Any run failure, including a defect or a runtime that cannot start,
 * withholds the program.
 */
export const referralReleaseRunPolicy = {
  whenRunFails: "close",
  failureCode: "referral_feature_flag_unavailable",
} as const satisfies ReleaseGateRunPolicy;
