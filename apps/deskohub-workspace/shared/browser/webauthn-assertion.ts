import {
  type AuthenticationResponseJSON,
  base64URLStringToBuffer,
  bufferToBase64URLString,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

/** A passkey assertion as the server verifies it. */
export type PasskeyAssertion = Omit<
  AuthenticationResponseJSON,
  "clientExtensionResults"
>;

// Conditional requests need an empty allow list, and an empty one would
// block a modal request.
const toAllowCredentials = (
  { allowCredentials }: PublicKeyCredentialRequestOptionsJSON,
  conditional: boolean
): PublicKeyCredentialDescriptor[] | undefined => {
  if (conditional) return [];
  if (!allowCredentials?.length) return undefined;
  return allowCredentials.map((descriptor) => ({
    ...descriptor,
    id: base64URLStringToBuffer(descriptor.id),
    transports: descriptor.transports as AuthenticatorTransport[] | undefined,
  }));
};

/**
 * Asks the browser for a passkey assertion for the server's request options,
 * as `startAuthentication` from `@simplewebauthn/browser` does, but under the
 * caller's `signal`. That library aborts its previous request only when it
 * starts the next, after an asynchronous autofill check, so it can't cancel a
 * request that hasn't started yet. `conditional` offers the passkeys in the
 * autofill of a `webauthn` field and waits until the customer picks one; the
 * caller checks that the browser supports it first. Rejects with the
 * browser's error.
 */
export const getPasskeyAssertion = async (
  options: PublicKeyCredentialRequestOptionsJSON,
  {
    conditional,
    signal,
  }: { readonly conditional: boolean; readonly signal: AbortSignal }
): Promise<PasskeyAssertion> => {
  const credential = await navigator.credentials.get({
    mediation: conditional ? "conditional" : undefined,
    publicKey: {
      ...options,
      challenge: base64URLStringToBuffer(options.challenge),
      allowCredentials: toAllowCredentials(options, conditional),
    },
    signal,
  });
  if (credential === null) throw new Error("No passkey was picked.");
  const { id, rawId, response, type, authenticatorAttachment } =
    credential as PublicKeyCredential;
  const assertion = response as AuthenticatorAssertionResponse;
  return {
    id,
    rawId: bufferToBase64URLString(rawId),
    response: {
      authenticatorData: bufferToBase64URLString(assertion.authenticatorData),
      clientDataJSON: bufferToBase64URLString(assertion.clientDataJSON),
      signature: bufferToBase64URLString(assertion.signature),
      userHandle: assertion.userHandle
        ? bufferToBase64URLString(assertion.userHandle)
        : undefined,
    },
    type: type as PasskeyAssertion["type"],
    authenticatorAttachment:
      authenticatorAttachment === "platform" ||
      authenticatorAttachment === "cross-platform"
        ? authenticatorAttachment
        : undefined,
  };
};
