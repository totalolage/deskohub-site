import { Data } from "effect";

/** The auth session closed and no callback finished the sign-in. */
export class SignInCancelled extends Data.TaggedError("SignInCancelled") {}

/**
 * The callback can't finish a sign-in: it is malformed, carries a provider
 * error, belongs to no sign-in the app started (or to another one), or
 * arrived after the attempt expired.
 */
export class SignInLinkRefused extends Data.TaggedError("SignInLinkRefused")<{
  readonly reason:
    | "invalid"
    | "provider-error"
    | "no-pending-sign-in"
    | "state-mismatch"
    | "expired";
}> {}

/** The server refused the token or handoff code: used, expired or wrong. */
export class SignInRejected extends Data.TaggedError("SignInRejected")<{
  readonly code?: string;
}> {}

/** The network, secure storage, the browser or crypto failed. */
export class SignInUnavailable extends Data.TaggedError("SignInUnavailable")<{
  readonly cause?: unknown;
}> {}

/**
 * A sign-in reached a different account than the app's: the server refused
 * the link, or the app signed the new session out. The app's own session
 * stays; it never switches accounts silently.
 */
export class AccountSwitchRefused extends Data.TaggedError(
  "AccountSwitchRefused"
) {}

/** A reauthentication needs a signed-in session to confirm. */
export class NotSignedIn extends Data.TaggedError("NotSignedIn") {}

export type NativeSignInFailure =
  | SignInCancelled
  | SignInLinkRefused
  | SignInRejected
  | SignInUnavailable
  | AccountSwitchRefused
  | NotSignedIn;
