import "server-only";

import { releaseGateForRequest } from "@/features/feature-flags/backend/release-gate.server";
import {
  PasskeyReleaseGate,
  SignInCodeReleaseGate,
} from "../backend/account-release-gates";

// A run that fails beyond a gate's own fail-closed policy, such as a runtime
// that cannot start, rejects; the auth guard then refuses the request.
const signInCodeRequest = releaseGateForRequest(SignInCodeReleaseGate, {
  operation: "account.sign-in-code-enabled",
  whenRunFails: "reject",
});

const passkeyRequest = releaseGateForRequest(PasskeyReleaseGate, {
  operation: "account.passkeys-enabled",
  whenRunFails: "reject",
});

/** Read once per sign-in email by the send request's auth guard. */
export const isSignInCodeEnabled = signInCodeRequest.isOpen;

/**
 * `login_passkeys`, decided once per render: account pages read it to show
 * passkey surfaces, and the auth guard reads it once per registration
 * request.
 */
export const arePasskeysEnabled = passkeyRequest.isOpen;

/** The passkey gate backed by the request's one decision. */
export const PasskeyReleaseGateRequest = passkeyRequest.layer;
