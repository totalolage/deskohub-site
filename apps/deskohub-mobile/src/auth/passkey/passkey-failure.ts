import { Data } from "effect";

/*
 * The ways a passkey ceremony ends without a sign-in or a new passkey. The
 * platform modules map their native, browser and server errors onto these, so
 * screens handle one closed union on every platform.
 */

/** The customer closed the passkey prompt, or the system interrupted it. */
export class PasskeyCancelled extends Data.TaggedError("PasskeyCancelled") {}

/** This device or browser can't use passkeys for the app. */
export class PasskeyNotSupported extends Data.TaggedError(
  "PasskeyNotSupported"
) {}

/** No passkey for the app's sign-in is saved on this device. */
export class PasskeyNoCredential extends Data.TaggedError(
  "PasskeyNoCredential"
) {}

/** The authenticator already holds a passkey for this account. */
export class PasskeyAlreadyRegistered extends Data.TaggedError(
  "PasskeyAlreadyRegistered"
) {}

/** Another passkey ceremony of the app is still running. */
export class PasskeyCeremonyBusy extends Data.TaggedError(
  "PasskeyCeremonyBusy"
) {}

/**
 * The server refused a ceremony step. `code` is the Better Auth error code,
 * such as `SESSION_NOT_FRESH` (adding a passkey needs a recent sign-in),
 * `PASSKEY_ACCOUNT_MISMATCH` or `PASSKEY_USER_VERIFICATION_REQUIRED`.
 */
export class PasskeyRejected extends Data.TaggedError("PasskeyRejected")<{
  readonly status: number;
  readonly code: string | undefined;
}> {
  /** Whether the caller must reauthenticate before it tries again. */
  get needsReauthentication(): boolean {
    return this.code === "SESSION_NOT_FRESH";
  }
}

/**
 * The ceremony failed for another reason: the request didn't reach the
 * server, the authenticator reported an unexpected error, or a response had
 * an unexpected shape. `cause` keeps the original error for diagnostics; it
 * is never shown to the customer.
 */
export class PasskeyCeremonyFailed extends Data.TaggedError(
  "PasskeyCeremonyFailed"
)<{
  readonly step: "request" | "authenticator" | "response";
  readonly cause?: unknown;
}> {}

export type PasskeyFailure =
  | PasskeyCancelled
  | PasskeyNotSupported
  | PasskeyNoCredential
  | PasskeyAlreadyRegistered
  | PasskeyCeremonyBusy
  | PasskeyRejected
  | PasskeyCeremonyFailed;
