import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Data } from "effect";

const ivByteLength = 12;
const authTagByteLength = 16;
const keyByteLength = 32;

export type CheckoutStateKey = {
  readonly kid: string;
  readonly key: Buffer;
};

export type CheckoutStateCryptoOptions = {
  readonly keys?: readonly CheckoutStateKey[];
  readonly now?: () => Date;
  readonly randomBytes?: (size: number) => Buffer;
};

export class CheckoutStateTokenError extends Data.TaggedError(
  "CheckoutStateTokenError"
)<{
  readonly code:
    | "missing-secret"
    | "invalid-secret"
    | "invalid-token"
    | "unknown-kid"
    | "expired";
  readonly message: string;
}> {}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const base64UrlEncode = (bytes: Buffer | Uint8Array | string) =>
  Buffer.from(bytes).toString("base64url");

const base64UrlDecode = (value: string) => Buffer.from(value, "base64url");

export const parseCheckoutStateKey = (
  kid: string,
  base64UrlKey: string
): CheckoutStateKey => {
  const key = base64UrlDecode(base64UrlKey);
  if (key.byteLength !== keyByteLength) {
    throw new CheckoutStateTokenError({
      code: "invalid-secret",
      message: "Checkout state encryption keys must decode to 32 bytes.",
    });
  }

  return { kid, key };
};

const getCheckoutStateKeysFromEnvironment = (): readonly CheckoutStateKey[] => {
  const rawKeys = process.env.CHECKOUT_PAY_STATE_KEYS;

  if (!rawKeys) {
    throw new CheckoutStateTokenError({
      code: "missing-secret",
      message:
        "CHECKOUT_PAY_STATE_KEYS is required to seal/open checkout state.",
    });
  }

  return rawKeys.split(",").map((entry) => {
    const [kid, key] = entry.split(":");
    if (!kid || !key) {
      throw new CheckoutStateTokenError({
        code: "invalid-secret",
        message:
          "CHECKOUT_PAY_STATE_KEYS entries must be formatted as kid:base64url-32-byte-key.",
      });
    }

    return parseCheckoutStateKey(kid, key);
  });
};

export const getCheckoutStateKeys = (
  options: CheckoutStateCryptoOptions = {}
) => {
  const keys = options.keys ?? getCheckoutStateKeysFromEnvironment();
  if (keys.length === 0) {
    throw new CheckoutStateTokenError({
      code: "missing-secret",
      message: "At least one checkout state encryption key is required.",
    });
  }

  for (const key of keys) {
    if (key.key.byteLength !== keyByteLength) {
      throw new CheckoutStateTokenError({
        code: "invalid-secret",
        message: "Checkout state encryption keys must be 32 bytes.",
      });
    }
  }

  return keys;
};

export const getCheckoutStateNowMilliseconds = (
  options: CheckoutStateCryptoOptions = {}
) => (options.now?.() ?? new Date()).getTime();

const getCheckoutStateKeyByKid = (
  kid: string,
  options: CheckoutStateCryptoOptions = {}
) => {
  const key = getCheckoutStateKeys(options).find(
    (candidate) => candidate.kid === kid
  );
  if (!key) {
    throw new CheckoutStateTokenError({
      code: "unknown-kid",
      message: "Checkout state token used an unknown key id.",
    });
  }

  return key;
};

const parseTokenParts = (token: string) => {
  const tokenParts = token.split(".");
  const [encodedHeader, encodedIv, encodedCiphertext, encodedAuthTag] =
    tokenParts;
  if (
    tokenParts.length !== 4 ||
    !encodedHeader ||
    !encodedIv ||
    !encodedCiphertext ||
    !encodedAuthTag
  ) {
    throw new CheckoutStateTokenError({
      code: "invalid-token",
      message: "Invalid checkout state token.",
    });
  }

  return { encodedHeader, encodedIv, encodedCiphertext, encodedAuthTag };
};

const parseJson = (value: Buffer, message: string): unknown => {
  try {
    return JSON.parse(textDecoder.decode(value));
  } catch {
    throw new CheckoutStateTokenError({ code: "invalid-token", message });
  }
};

export const sealCheckoutState = (
  state: { readonly kid: string },
  options: CheckoutStateCryptoOptions = {}
) => {
  const key = getCheckoutStateKeyByKid(state.kid, options);
  const encodedHeader = base64UrlEncode(JSON.stringify({ kid: key.kid }));
  const iv = options.randomBytes?.(ivByteLength) ?? randomBytes(ivByteLength);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv, {
    authTagLength: authTagByteLength,
  });

  cipher.setAAD(textEncoder.encode(encodedHeader));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(state), "utf8"),
    cipher.final(),
  ]);

  return [
    encodedHeader,
    base64UrlEncode(iv),
    base64UrlEncode(ciphertext),
    base64UrlEncode(cipher.getAuthTag()),
  ].join(".");
};

export const openCheckoutState = <
  A extends {
    readonly kid: string;
    readonly exp: number;
  },
>(
  token: string,
  decodeHeader: (value: unknown) => { readonly kid: string } | undefined,
  decodeState: (value: unknown) => A | undefined,
  options: CheckoutStateCryptoOptions = {}
): A => {
  const { encodedHeader, encodedIv, encodedCiphertext, encodedAuthTag } =
    parseTokenParts(token);
  const header = decodeHeader(
    parseJson(
      base64UrlDecode(encodedHeader),
      "Invalid checkout state token header."
    )
  );
  if (!header) {
    throw new CheckoutStateTokenError({
      code: "invalid-token",
      message: "Invalid checkout state token header.",
    });
  }

  const key = getCheckoutStateKeyByKid(header.kid, options);
  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key.key,
      base64UrlDecode(encodedIv),
      { authTagLength: authTagByteLength }
    );
    decipher.setAAD(textEncoder.encode(encodedHeader));
    decipher.setAuthTag(base64UrlDecode(encodedAuthTag));
    plaintext = Buffer.concat([
      decipher.update(base64UrlDecode(encodedCiphertext)),
      decipher.final(),
    ]);
  } catch {
    throw new CheckoutStateTokenError({
      code: "invalid-token",
      message: "Invalid checkout state token.",
    });
  }

  const state = decodeState(
    parseJson(plaintext, "Invalid checkout state token payload.")
  );
  if (!state || state.kid !== header.kid) {
    throw new CheckoutStateTokenError({
      code: "invalid-token",
      message: "Invalid checkout state token payload.",
    });
  }

  if (
    state.exp <= Math.floor(getCheckoutStateNowMilliseconds(options) / 1000)
  ) {
    throw new CheckoutStateTokenError({
      code: "expired",
      message: "Checkout state token expired.",
    });
  }

  return state;
};
