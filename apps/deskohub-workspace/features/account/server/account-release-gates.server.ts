import "server-only";

import { releaseGateForRequest } from "@/features/feature-flags/backend/release-gate.server";
import {
  accountReleaseRunPolicy,
  PasskeyReleaseGate,
} from "../backend/account-release-gates";

// A run that fails beyond the gate's own fail-closed policy, such as a
// runtime that cannot start, rejects.
const passkeyRequest = releaseGateForRequest(PasskeyReleaseGate, {
  operation: "account.passkeys-enabled",
  ...accountReleaseRunPolicy,
});

/**
 * `login_passkeys`, decided once per render: account pages read it to show
 * passkey surfaces. The auth guard decides it in its own run instead.
 */
export const arePasskeysEnabled = passkeyRequest.isOpen;

/** The passkey gate backed by the request's one decision. */
export const PasskeyReleaseGateRequest = passkeyRequest.layer;
