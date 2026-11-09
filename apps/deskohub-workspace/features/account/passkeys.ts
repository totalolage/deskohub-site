import { type Locale, m } from "@/features/i18n";

/*
 * Wiring contract between the passkey screens and the browser passkey client.
 * The screens only render outcomes; the client maps Better Auth and WebAuthn
 * results onto these unions. Every passkey surface hides while
 * `login_passkeys` is off.
 */

export type AccountPasskey = {
  readonly id: string;
  /**
   * The customer's name for it, or the provider name the server gave it.
   * Absent for an unknown authenticator; see `passkeyDisplayName`.
   */
  readonly name: string | undefined;
  /** Provider resolved from the authenticator AAGUID, such as "iCloud Keychain". */
  readonly provider: string | undefined;
  /** ISO 8601 creation time. */
  readonly createdAt: string;
};

/**
 * The signed-in account's passkeys for the account page. Absent from the page
 * state while `login_passkeys` is off.
 */
export type AccountPasskeySettings = {
  /** The account the browser-local passkey markers are keyed by. */
  readonly accountId: string;
  /** Null when the list couldn't be read. */
  readonly passkeys: readonly AccountPasskey[] | null;
};

/** Longest passkey name the rename dialog accepts. */
export const PASSKEY_NAME_MAXIMUM_LENGTH = 64;

export const passkeyDisplayName = (
  passkey: Pick<AccountPasskey, "name">,
  locale: Locale
): string =>
  passkey.name ?? m.accountSecurityPasskeyDefaultName({}, { locale });

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
