import { releaseGateForRun } from "@/features/feature-flags/backend/release-gate-run";
import {
  AccountAvatarReleaseGate,
  accountReleaseRunPolicy,
  PasskeyReleaseGate,
  SignInCodeReleaseGate,
} from "./account-release-gates";

/**
 * The sign-in code gate decided once per build, for a run outside Next.js
 * request scope, such as a Better Auth hook. Build it once per run.
 */
export const SignInCodeReleaseGateForRun = releaseGateForRun(
  SignInCodeReleaseGate,
  accountReleaseRunPolicy
);

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
