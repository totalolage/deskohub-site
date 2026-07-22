import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Config, Data, Effect, Schema } from "effect";

const ivByteLength = 12;
const authTagByteLength = 16;
const keyByteLength = 32;

export const checkoutStateClaimsSchema = Schema.Struct({
  kid: Schema.NonEmptyString,
  iat: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  exp: Schema.Int.check(Schema.isGreaterThan(0)),
});

export const checkoutStateProtectedHeaderSchema = Schema.Struct({
  kid: checkoutStateClaimsSchema.fields.kid,
});

export type CheckoutStateClaims = typeof checkoutStateClaimsSchema.Type;

export type CheckoutStateKey = {
  readonly kid: string;
  readonly key: Buffer;
};

type CheckoutStateKeys = readonly [CheckoutStateKey, ...CheckoutStateKey[]];

export type CheckoutStateCryptoOptions = {
  readonly keys?: readonly CheckoutStateKey[];
  readonly now?: () => Date;
  readonly randomBytes?: (size: number) => Buffer;
};

const checkoutStateTokenErrorTag = "CheckoutStateTokenError";

export class CheckoutStateTokenError extends Data.TaggedError(
  checkoutStateTokenErrorTag
)<{
  readonly code:
    | "missing-secret"
    | "invalid-secret"
    | "invalid-token"
    | "unknown-kid"
    | "expired";
  readonly message: string;
  readonly cause?: unknown;
}> {
  static readonly _tag = checkoutStateTokenErrorTag;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const invalidSecret = (message: string, cause?: unknown) =>
  new CheckoutStateTokenError({ code: "invalid-secret", message, cause });

const invalidToken = (message: string, cause?: unknown) =>
  new CheckoutStateTokenError({ code: "invalid-token", message, cause });

const base64UrlEncode = (bytes: Buffer | Uint8Array | string) =>
  Buffer.from(bytes).toString("base64url");

const base64UrlDecode = Effect.fn("checkoutStateToken.base64UrlDecode")(
  (value: string, message: string) =>
    Effect.try({
      try: () => Buffer.from(value, "base64url"),
      catch: (cause) => invalidToken(message, cause),
    })
);

export const parseCheckoutStateKey = Effect.fn("checkoutStateToken.parseKey")(
  function* (kid: string, base64UrlKey: string) {
    const key = yield* Effect.try({
      try: () => Buffer.from(base64UrlKey, "base64url"),
      catch: (cause) =>
        invalidSecret(
          "Checkout state encryption key is not valid base64url.",
          cause
        ),
    });

    if (key.byteLength !== keyByteLength) {
      return yield* invalidSecret(
        "Checkout state encryption keys must decode to 32 bytes."
      );
    }

    return { kid, key } satisfies CheckoutStateKey;
  }
);

export const parseCheckoutStateKeys = Effect.fn("checkoutStateToken.parseKeys")(
  function* (rawKeys: string) {
    const entries = rawKeys.split(",");
    const keys = yield* Effect.forEach(entries, (entry) => {
      const [kid, key, ...extra] = entry.split(":");
      if (!kid || !key || extra.length > 0) {
        return Effect.fail(
          invalidSecret(
            "CHECKOUT_PAY_STATE_KEYS entries must be formatted as kid:base64url-32-byte-key."
          )
        );
      }

      return parseCheckoutStateKey(kid, key);
    });

    const [first, ...rest] = keys;
    if (!first) {
      return yield* new CheckoutStateTokenError({
        code: "missing-secret",
        message: "At least one checkout state encryption key is required.",
      });
    }

    return [first, ...rest] as CheckoutStateKeys;
  }
);

const loadConfiguredCheckoutStateKeys = Effect.fn(
  "checkoutStateToken.loadConfiguredKeys"
)(() =>
  Config.string("CHECKOUT_PAY_STATE_KEYS").pipe(
    Effect.mapError((cause) =>
      invalidSecret("Workspace checkout state configuration is invalid.", cause)
    ),
    Effect.flatMap(parseCheckoutStateKeys)
  )
);

export const getCheckoutStateKeys = Effect.fn("checkoutStateToken.getKeys")(
  function* (options: CheckoutStateCryptoOptions = {}) {
    const keys = options.keys
      ? [...options.keys]
      : [...(yield* loadConfiguredCheckoutStateKeys())];

    const [first, ...rest] = keys;
    if (!first) {
      return yield* new CheckoutStateTokenError({
        code: "missing-secret",
        message: "At least one checkout state encryption key is required.",
      });
    }

    for (const key of keys) {
      if (key.key.byteLength !== keyByteLength) {
        return yield* invalidSecret(
          "Checkout state encryption keys must be 32 bytes."
        );
      }
    }

    return [first, ...rest] as CheckoutStateKeys;
  }
);

const getCheckoutStateNowMilliseconds = Effect.fn(
  "checkoutStateToken.getNowMilliseconds"
)((options: CheckoutStateCryptoOptions = {}) =>
  Effect.try({
    try: () => (options.now?.() ?? new Date()).getTime(),
    catch: (cause) => invalidToken("Checkout state clock failed.", cause),
  })
);

export const createCheckoutStateClaims = Effect.fn(
  "checkoutStateToken.createClaims"
)(function* (
  ttlMilliseconds: number,
  options: CheckoutStateCryptoOptions = {}
) {
  const [activeKey] = yield* getCheckoutStateKeys(options);
  const nowMilliseconds = yield* getCheckoutStateNowMilliseconds(options);

  return yield* Schema.decodeUnknownEffect(checkoutStateClaimsSchema)({
    kid: activeKey.kid,
    iat: Math.floor(nowMilliseconds / 1000),
    exp: Math.floor((nowMilliseconds + ttlMilliseconds) / 1000),
  }).pipe(
    Effect.mapError((cause) =>
      invalidToken("Checkout state claims are invalid.", cause)
    )
  );
});

const getCheckoutStateKeyByKid = Effect.fn("checkoutStateToken.getKeyByKid")(
  function* (kid: string, options: CheckoutStateCryptoOptions = {}) {
    const keys = yield* getCheckoutStateKeys(options);
    const key = keys.find((candidate) => candidate.kid === kid);
    if (!key) {
      return yield* new CheckoutStateTokenError({
        code: "unknown-kid",
        message: "Checkout state token used an unknown key id.",
      });
    }

    return key;
  }
);

const parseTokenParts = Effect.fn("checkoutStateToken.parseParts")(function* (
  token: string
) {
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
    return yield* invalidToken("Invalid checkout state token.");
  }

  return {
    encodedHeader,
    encodedIv,
    encodedCiphertext,
    encodedAuthTag,
  };
});

const parseJson = Effect.fn("checkoutStateToken.parseJson")(
  (value: Buffer, message: string) =>
    Effect.try({
      try: () => JSON.parse(textDecoder.decode(value)) as unknown,
      catch: (cause) => invalidToken(message, cause),
    })
);

const stringifyJson = Effect.fn("checkoutStateToken.stringifyJson")(
  (value: unknown) =>
    Effect.try({
      try: () => JSON.stringify(value),
      catch: (cause) =>
        invalidToken("Checkout state could not be serialized.", cause),
    })
);

const decodeProtectedHeader = Schema.decodeUnknownEffect(
  checkoutStateProtectedHeaderSchema,
  { onExcessProperty: "error" }
);

export const sealCheckoutState = Effect.fn("checkoutStateToken.seal")(
  function* (
    state: { readonly kid: string },
    options: CheckoutStateCryptoOptions = {}
  ) {
    const key = yield* getCheckoutStateKeyByKid(state.kid, options);
    const headerJson = yield* stringifyJson({ kid: key.kid });
    const stateJson = yield* stringifyJson(state);

    return yield* Effect.try({
      try: () => {
        const encodedHeader = base64UrlEncode(headerJson);
        const iv =
          options.randomBytes?.(ivByteLength) ?? randomBytes(ivByteLength);
        const cipher = createCipheriv("aes-256-gcm", key.key, iv, {
          authTagLength: authTagByteLength,
        });

        cipher.setAAD(textEncoder.encode(encodedHeader));
        const ciphertext = Buffer.concat([
          cipher.update(stateJson, "utf8"),
          cipher.final(),
        ]);

        return [
          encodedHeader,
          base64UrlEncode(iv),
          base64UrlEncode(ciphertext),
          base64UrlEncode(cipher.getAuthTag()),
        ].join(".");
      },
      catch: (cause) =>
        invalidToken("Checkout state could not be sealed.", cause),
    });
  }
);

export const openCheckoutState = Effect.fn("checkoutStateToken.open")(
  function* <A extends CheckoutStateClaims>(
    token: string,
    schema: Schema.Decoder<A>,
    options: CheckoutStateCryptoOptions = {}
  ) {
    const { encodedHeader, encodedIv, encodedCiphertext, encodedAuthTag } =
      yield* parseTokenParts(token);
    const encodedHeaderBytes = yield* base64UrlDecode(
      encodedHeader,
      "Invalid checkout state token header."
    );
    const headerJson = yield* parseJson(
      encodedHeaderBytes,
      "Invalid checkout state token header."
    );
    const header = yield* decodeProtectedHeader(headerJson).pipe(
      Effect.mapError((cause) =>
        invalidToken("Invalid checkout state token header.", cause)
      )
    );
    const key = yield* getCheckoutStateKeyByKid(header.kid, options);
    const [iv, ciphertext, authTag] = yield* Effect.all([
      base64UrlDecode(encodedIv, "Invalid checkout state token."),
      base64UrlDecode(encodedCiphertext, "Invalid checkout state token."),
      base64UrlDecode(encodedAuthTag, "Invalid checkout state token."),
    ]);
    const plaintext = yield* Effect.try({
      try: () => {
        const decipher = createDecipheriv("aes-256-gcm", key.key, iv, {
          authTagLength: authTagByteLength,
        });
        decipher.setAAD(textEncoder.encode(encodedHeader));
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      },
      catch: (cause) => invalidToken("Invalid checkout state token.", cause),
    });
    const stateJson = yield* parseJson(
      plaintext,
      "Invalid checkout state token payload."
    );
    const state = yield* Schema.decodeUnknownEffect(schema, {
      onExcessProperty: "error",
    })(stateJson).pipe(
      Effect.mapError((cause) =>
        invalidToken("Invalid checkout state token payload.", cause)
      )
    );

    if (state.kid !== header.kid) {
      return yield* invalidToken("Invalid checkout state token payload.");
    }

    const nowMilliseconds = yield* getCheckoutStateNowMilliseconds(options);
    if (state.exp <= Math.floor(nowMilliseconds / 1000)) {
      return yield* new CheckoutStateTokenError({
        code: "expired",
        message: "Checkout state token expired.",
      });
    }

    return state;
  }
);
