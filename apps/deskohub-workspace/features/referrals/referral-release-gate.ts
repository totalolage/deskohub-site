import { ReleaseGate } from "@/features/feature-flags/backend/release-gate";

/**
 * `referrals`: the referral program. Next.js request code provides the
 * request's one decision (`ReferralReleaseGateRequest` in
 * `referral-release-gate.server.ts`), so pages, layouts, and services agree.
 */
export class ReferralReleaseGate extends ReleaseGate<ReferralReleaseGate>()(
  "@deskohub-workspace/referrals/ReferralReleaseGate",
  "referrals"
) {}
