/**
 * PKCE (RFC 7636) values for the native sign-in handoff. The app keeps the
 * verifier; the web sign-in page only sees the S256 challenge, and the
 * handoff exchange proves the app that started the sign-in is the one
 * finishing it.
 */

const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url, the encoding PKCE and the handoff state use. */
export const encodeBase64Url = (bytes: Uint8Array): string => {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    const remaining = bytes.length - index;
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    if (remaining > 1) out += alphabet[(triple >> 6) & 63];
    if (remaining > 2) out += alphabet[triple & 63];
  }
  return out;
};

/** Random bytes behind each verifier and each handoff state. */
export const pkceRandomByteCount = 32;

const verifierPattern = /^[A-Za-z0-9\-._~]{43,128}$/;

export const isPkceVerifier = (value: string): boolean =>
  verifierPattern.test(value);

/** A 43-character verifier from 32 random bytes. */
export const pkceVerifierFromBytes = (bytes: Uint8Array): string => {
  if (bytes.length < pkceRandomByteCount) {
    throw new RangeError("A PKCE verifier needs at least 32 random bytes.");
  }
  return encodeBase64Url(bytes);
};

/** The S256 challenge from the SHA-256 digest of the verifier's ASCII. */
export const pkceChallengeFromDigest = (digest: Uint8Array): string =>
  encodeBase64Url(digest);
