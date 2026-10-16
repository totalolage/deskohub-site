import { Predicate } from "effect";

// Older browsers lack these statics even where the DOM types declare them,
// and a throwing or rejecting check reads as unsupported.
const askPublicKeyCredential = async (
  check: (
    publicKeyCredential: typeof PublicKeyCredential
  ) => Promise<boolean | undefined> | undefined
): Promise<boolean> => {
  try {
    const publicKeyCredential = globalThis.PublicKeyCredential;
    if (publicKeyCredential === undefined) return false;
    return (await check(publicKeyCredential)) === true;
  } catch {
    return false;
  }
};

/**
 * Whether this browser can create a passkey with a built-in, user-verifying
 * authenticator or password manager. Browsers that report client
 * capabilities answer for passkeys directly; older ones answer for the
 * platform authenticator.
 */
export const canCreatePasskeys = (): Promise<boolean> =>
  askPublicKeyCredential(async (publicKeyCredential) => {
    if (Predicate.isFunction(publicKeyCredential.getClientCapabilities)) {
      const capabilities = await publicKeyCredential.getClientCapabilities();
      return (
        capabilities.passkeyPlatformAuthenticator === true ||
        capabilities.userVerifyingPlatformAuthenticator === true
      );
    }
    return Predicate.isFunction(
      publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
    )
      ? publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      : undefined;
  });

/** Whether this browser offers saved passkeys in a field's autofill. */
export const supportsPasskeyAutofill = (): Promise<boolean> =>
  askPublicKeyCredential((publicKeyCredential) =>
    Predicate.isFunction(publicKeyCredential.isConditionalMediationAvailable)
      ? publicKeyCredential.isConditionalMediationAvailable()
      : undefined
  );
