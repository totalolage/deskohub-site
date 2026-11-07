import { expect, test } from "bun:test";
import { fromNativePasskeyError } from "./native-passkey-error";

/** A rejection as Expo modules deliver it: an Error with a `code`. */
const moduleError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

test.each([
  // Android Credential Manager outcomes
  [moduleError("Passkey Get", "UserCancelled"), "PasskeyCancelled"],
  [moduleError("Passkey Create", "Interrupted"), "PasskeyCancelled"],
  [
    moduleError("Passkey Get", "DomError: NotAllowedError - timed out"),
    "PasskeyCancelled",
  ],
  [moduleError("Passkey Get", "NoCredentials"), "PasskeyNoCredential"],
  [
    moduleError(
      "Passkey Create",
      "DomError: InvalidStateError - credential already exists"
    ),
    "PasskeyAlreadyRegistered",
  ],
  [
    moduleError(
      "Passkey Create",
      "androidx.credentials.exceptions.CreateCredentialNoCreateOptionException: no provider"
    ),
    "PasskeyNotSupported",
  ],
  [moduleError("Passkey Get", "NotConfigured"), "PasskeyNotSupported"],
  [moduleError("Passkey Create", "NotSupported"), "PasskeyNotSupported"],
  [moduleError("Passkey Get", "UnknownError"), "PasskeyCeremonyFailed"],
  [
    moduleError("Passkey Get", "DomError: SecurityError - bad RP ID"),
    "PasskeyCeremonyFailed",
  ],
  // iOS exception codes
  [moduleError("ERR_USER_CANCELLED", "User cancelled"), "PasskeyCancelled"],
  [moduleError("ERR_NOT_SUPPORTED", "iOS 15+"), "PasskeyNotSupported"],
  [moduleError("ERR_NOT_CONFIGURED", "AASA"), "PasskeyNotSupported"],
  [moduleError("ERR_BIOMETRIC", "Biometrics"), "PasskeyNotSupported"],
  [
    moduleError("ERR_PENDING_PASSKEY_REQUEST", "Pending"),
    "PasskeyCeremonyBusy",
  ],
  [moduleError("ERR_UNKNOWN", "Unknown"), "PasskeyCeremonyFailed"],
  // Anything else
  ["not an error", "PasskeyCeremonyFailed"],
  [undefined, "PasskeyCeremonyFailed"],
])("maps %p to %s", (cause, tag) => {
  expect<string>(fromNativePasskeyError(cause)._tag).toBe(tag);
});

test("keeps an unexpected error as the failure's cause", () => {
  const cause = moduleError("Passkey Get", "UnknownError");

  expect(fromNativePasskeyError(cause)).toMatchObject({
    _tag: "PasskeyCeremonyFailed",
    step: "authenticator",
    cause,
  });
});
