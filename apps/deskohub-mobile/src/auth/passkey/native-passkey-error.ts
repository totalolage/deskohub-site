import {
  PasskeyAlreadyRegistered,
  PasskeyCancelled,
  PasskeyCeremonyBusy,
  PasskeyCeremonyFailed,
  type PasskeyFailure,
  PasskeyNoCredential,
  PasskeyNotSupported,
} from "./passkey-failure";

/*
 * `react-native-passkeys` rejects with an Expo module error. On Android the
 * error's `code` names the call ("Passkey Create", "Passkey Get") and its
 * message carries the Credential Manager outcome: `UserCancelled`,
 * `Interrupted`, `NotConfigured`, `NotSupported`, `NoCredentials`,
 * `UnknownError`, `DomError: <DOMException type> - <message>`, or the
 * exception's own text (such as a `NoCreateOptionException`). On iOS the
 * `code` comes from the Swift exception class: `ERR_USER_CANCELLED`,
 * `ERR_NOT_SUPPORTED`, `ERR_NOT_CONFIGURED`, `ERR_PENDING_PASSKEY_REQUEST`,
 * `ERR_BIOMETRIC` and others.
 */

const textOf = (cause: unknown, key: "code" | "message"): string => {
  if (typeof cause !== "object" || cause === null || !(key in cause)) {
    return "";
  }
  const value = (cause as Record<typeof key, unknown>)[key];
  return typeof value === "string" ? value : "";
};

type Outcome = () => PasskeyFailure;

const cancelled: Outcome = () => new PasskeyCancelled();
const notSupported: Outcome = () => new PasskeyNotSupported();

/** iOS outcomes by the module error's `code`. */
const byCode: Readonly<Record<string, Outcome>> = {
  ERR_USER_CANCELLED: cancelled,
  ERR_NOT_SUPPORTED: notSupported,
  // The app's associated domain isn't verified for this device yet.
  ERR_NOT_CONFIGURED: notSupported,
  ERR_BIOMETRIC: notSupported,
  ERR_PENDING_PASSKEY_REQUEST: () => new PasskeyCeremonyBusy(),
};

/**
 * Android outcomes by the text in the module error's message, which Expo may
 * wrap in its own call context.
 */
const byMessage: readonly (readonly [string, Outcome])[] = [
  ["UserCancelled", cancelled],
  // The system interrupted the prompt, for example when the app moved to
  // the background; the customer can start again.
  ["Interrupted", cancelled],
  // The customer dismissed the prompt or let it time out.
  ["DomError: NotAllowedError", cancelled],
  ["DomError: InvalidStateError", () => new PasskeyAlreadyRegistered()],
  ["NoCredentials", () => new PasskeyNoCredential()],
  // No credential provider on the device can save a passkey.
  ["CreateCredentialNoCreateOptionException", notSupported],
  // No provider is set up, for example without Google Play services.
  ["NotConfigured", notSupported],
  ["NotSupported", notSupported],
];

/** Maps a rejection of the native passkey module to a ceremony failure. */
export const fromNativePasskeyError = (cause: unknown): PasskeyFailure => {
  const message = textOf(cause, "message");
  const outcome =
    byCode[textOf(cause, "code")] ??
    byMessage.find(([text]) => message.includes(text))?.[1];
  return outcome
    ? outcome()
    : new PasskeyCeremonyFailed({ step: "authenticator", cause });
};
