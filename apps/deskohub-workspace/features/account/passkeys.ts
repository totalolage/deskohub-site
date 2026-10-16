/*
 * Wiring contract between the passkey screens and the browser passkey client.
 * The screens only render outcomes; the client slice maps Better Auth and
 * WebAuthn results onto these unions.
 *
 * TODO(login_passkeys): every passkey surface hides while the flag is off.
 */

export type AccountPasskey = {
  readonly id: string;
  readonly name: string;
  /** Provider resolved from the authenticator AAGUID, such as "iCloud Keychain". */
  readonly provider: string | undefined;
  /** ISO 8601 creation time. */
  readonly createdAt: string;
};

/** Longest passkey name the rename dialog accepts. */
export const PASSKEY_NAME_MAXIMUM_LENGTH = 64;

/** A cancelled browser prompt is silent; only a failure shows a message. */
export type PasskeySignInResult = "signed-in" | "cancelled" | "failed";

export type PasskeyCreationResult =
  | "created"
  /** The session is too old to register a passkey; confirm it's you first. */
  | "reauthentication-required"
  | "cancelled"
  | "failed";

/** Confirming a stale session with one of the account's own passkeys. */
export type PasskeyConfirmationResult =
  | "confirmed"
  /** The chosen passkey belongs to a different account. */
  | "wrong-account"
  | "cancelled"
  | "failed";

export type PasskeyChangeResult = "saved" | "failed";
