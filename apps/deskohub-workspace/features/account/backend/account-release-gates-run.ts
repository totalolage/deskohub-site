import { releaseGateForRun } from "@/features/feature-flags/backend/release-gate-run";
import {
  AccountAvatarReleaseGate,
  accountReleaseRunPolicy,
  PasskeyReleaseGate,
} from "./account-release-gates";

/**
 * The passkey gate decided once per build, for a request served outside
 * Next.js, such as the customer HTTP API. Build it once per request.
 */
export const PasskeyReleaseGateForRun = releaseGateForRun(
  PasskeyReleaseGate,
  accountReleaseRunPolicy
);

/**
 * The avatar gate decided once per build, for a request served outside
 * Next.js. Build it once per request.
 */
export const AccountAvatarReleaseGateForRun = releaseGateForRun(
  AccountAvatarReleaseGate,
  accountReleaseRunPolicy
);
