import { ReleaseGate } from "@/features/feature-flags/backend/release-gate";
import type { ReleaseGateRunPolicy } from "@/features/feature-flags/backend/release-gate-run";

/** `login_email_code`: sign-in emails carry a code. */
export class SignInCodeReleaseGate extends ReleaseGate<SignInCodeReleaseGate>()(
  "@deskohub-workspace/account/SignInCodeReleaseGate",
  "login_email_code"
) {}

/**
 * `login_passkeys`: passkey surfaces show and new passkeys can be added.
 * Passkey sign-in doesn't depend on it.
 */
export class PasskeyReleaseGate extends ReleaseGate<PasskeyReleaseGate>()(
  "@deskohub-workspace/account/PasskeyReleaseGate",
  "login_passkeys"
) {}

/** `account_avatars`: customers can see, upload, and remove an avatar. */
export class AccountAvatarReleaseGate extends ReleaseGate<AccountAvatarReleaseGate>()(
  "@deskohub-workspace/account/AccountAvatarReleaseGate",
  "account_avatars"
) {}

/**
 * A run that fails beyond an account gate's own fail-closed policy, such as a
 * runtime that cannot start, rejects; the request then fails instead of
 * guessing the gate.
 */
export const accountReleaseRunPolicy = {
  whenRunFails: "reject",
} as const satisfies ReleaseGateRunPolicy;
