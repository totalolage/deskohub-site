import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { Config, Data, Effect, Schema } from "effect";

/*
 * Short-lived state sealed with AES-256-GCM for a round trip through the
 * browser, such as a URL parameter. Every token is encrypted and
 * authenticated with the first key of the `CHECKOUT_PAY_STATE_KEYS` ring and
 * opens with any key of it, so key rotation follows the checkout key ring.
 */

const ivByteLength = 12;
const syntheticIvKeyInfo = "deskohub sealed-state synthetic IV";
const authTagByteLength = 16;
const keyByteLength = 32;
// Far above any state that fits a URL, so a crafted token can't inflate into
// a large allocation.
const maxInflatedStateByteLength = 64 * 1024;

export const sealedStateKeyIdSchema = Schema.Trim.check(Schema.isNonEmpty())
  .pipe(Schema.brand("SealedStateKeyId"))
  .annotate({
    identifier: "SealedStateKeyId",
    description: "Identifier selecting a sealed state encryption key.",
  });
export type SealedStateKeyId = typeof sealedStateKeyIdSchema.Type;

export const sealedStateClaimsSchema = Schema.Struct({
  kid: sealedStateKeyIdSchema,
  iat: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  exp: Schema.Int.check(Schema.isGreaterThan(0)),
});

// The header is the additional authenticated data, so the purpose can't be
// changed without failing authentication.
const sealedStateProtectedHeaderSchema = Schema.Struct({
  kid: sealedStateClaimsSchema.fields.kid,
  purpose: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  // JWE's `zip` header (RFC 7516): the plaintext is DEFLATE-compressed.
  zip: Schema.optional(Schema.Literal("DEF")),
});

export type SealedStateClaims = typeof sealedStateClaimsSchema.Type;

export type SealedStateKey = {
  readonly kid: SealedStateKeyId;
  readonly key: Buffer;
};

type SealedStateKeys = readonly [SealedStateKey, ...SealedStateKey[]];

export type SealedStateCryptoOptions = {
  readonly keys?: readonly SealedStateKey[];
  readonly now?: () => Date;
  readonly randomBytes?: (size: number) => Buffer;
  /**
   * Seals equal state under one key to the same token, for a link a repeated
   * request must return unchanged. The IV is a 96-bit MAC of the header and
   * plaintext (a synthetic IV, as in SIV), so different states get unrelated
   * IVs; the token reveals only that two seals carried equal state.
   */
  readonly syntheticIv?: boolean;
};

export type SealedStateOptions = SealedStateCryptoOptions & {
  /**
   * What the state is for. A token sealed for one purpose never opens for
   * another. Pay and advertised-price state predate purposes and seal
   * without one.
   */
  readonly purpose?: string;
  /**
   * Compresses the state before sealing, for state whose size matters, such
   * as one riding on a URL. A compressed length hints at the content, so
   * compress only state that holds nothing secret beside the input of the
   * person it is sealed for.
   */
  readonly compressed?: boolean;
};

const sealedStateTokenErrorTag = "SealedStateTokenError";

export class SealedStateTokenError extends Data.TaggedError(
  sealedStateTokenErrorTag
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
  static readonly _tag = sealedStateTokenErrorTag;
}

const sealedStateTooLargeErrorTag = "SealedStateTooLargeError";

/** The sealed token would be longer than its kind of state allows. */
export class SealedStateTooLargeError extends Data.TaggedError(
  sealedStateTooLargeErrorTag
)<{
  readonly maxTokenLength: number;
  readonly tokenLength: number;
}> {
  static readonly _tag = sealedStateTooLargeErrorTag;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const invalidSecret = (message: string, cause?: unknown) =>
  new SealedStateTokenError({ code: "invalid-secret", message, cause });

const invalidToken = (message: string, cause?: unknown) =>
  new SealedStateTokenError({ code: "invalid-token", message, cause });

const base64UrlEncode = (bytes: Buffer | Uint8Array | string) =>
  Buffer.from(bytes).toString("base64url");

const base64UrlDecode = Effect.fn("sealedState.base64UrlDecode")(
  (value: string, message: string) =>
    Effect.try({
      try: () => Buffer.from(value, "base64url"),
      catch: (cause) => invalidToken(message, cause),
    })
);

export const parseSealedStateKey = Effect.fn("sealedState.parseKey")(function* (
  kid: string,
  base64UrlKey: string
) {
  const decodedKid = yield* Schema.decodeUnknownEffect(sealedStateKeyIdSchema)(
    kid
  ).pipe(
    Effect.mapError((cause) =>
      invalidSecret("Sealed state key ID is invalid.", cause)
    )
  );
  const key = yield* Effect.try({
    try: () => Buffer.from(base64UrlKey, "base64url"),
    catch: (cause) =>
      invalidSecret(
        "Sealed state encryption key is not valid base64url.",
        cause
      ),
  });

  if (key.byteLength !== keyByteLength) {
    return yield* invalidSecret(
      "Sealed state encryption keys must decode to 32 bytes."
    );
  }

  return { kid: decodedKid, key } satisfies SealedStateKey;
});

export const parseSealedStateKeys = Effect.fn("sealedState.parseKeys")(
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

      return parseSealedStateKey(kid, key);
    });

    const [first, ...rest] = keys;
    if (!first) {
      return yield* new SealedStateTokenError({
        code: "missing-secret",
        message: "At least one sealed state encryption key is required.",
      });
    }

    return [first, ...rest] as SealedStateKeys;
  }
);

const loadConfiguredSealedStateKeys = Effect.fn(
  "sealedState.loadConfiguredKeys"
)(() =>
  Config.string("CHECKOUT_PAY_STATE_KEYS").pipe(
    Effect.mapError((cause) =>
      invalidSecret("Workspace sealed state configuration is invalid.", cause)
    ),
    Effect.flatMap(parseSealedStateKeys)
  )
);

const getSealedStateKeys = Effect.fn("sealedState.getKeys")(function* (
  options: SealedStateCryptoOptions = {}
) {
  const keys = options.keys
    ? [...options.keys]
    : [...(yield* loadConfiguredSealedStateKeys())];

  const [first, ...rest] = keys;
  if (!first) {
    return yield* new SealedStateTokenError({
      code: "missing-secret",
      message: "At least one sealed state encryption key is required.",
    });
  }

  for (const key of keys) {
    if (key.key.byteLength !== keyByteLength) {
      return yield* invalidSecret(
        "Sealed state encryption keys must be 32 bytes."
      );
    }
  }

  return [first, ...rest] as SealedStateKeys;
});

const getSealedStateNowMilliseconds = Effect.fn(
  "sealedState.getNowMilliseconds"
)((options: SealedStateCryptoOptions = {}) =>
  Effect.try({
    try: () => (options.now?.() ?? new Date()).getTime(),
    catch: (cause) => invalidToken("Sealed state clock failed.", cause),
  })
);

export const createSealedStateClaims = Effect.fn("sealedState.createClaims")(
  function* (ttlMilliseconds: number, options: SealedStateCryptoOptions = {}) {
    const [activeKey] = yield* getSealedStateKeys(options);
    const nowMilliseconds = yield* getSealedStateNowMilliseconds(options);

    return yield* Schema.decodeUnknownEffect(sealedStateClaimsSchema)({
      kid: activeKey.kid,
      iat: Math.floor(nowMilliseconds / 1000),
      exp: Math.floor((nowMilliseconds + ttlMilliseconds) / 1000),
    }).pipe(
      Effect.mapError((cause) =>
        invalidToken("Sealed state claims are invalid.", cause)
      )
    );
  }
);

const getSealedStateKeyByKid = Effect.fn("sealedState.getKeyByKid")(function* (
  kid: SealedStateKeyId,
  options: SealedStateCryptoOptions = {}
) {
  const keys = yield* getSealedStateKeys(options);
  const key = keys.find((candidate) => candidate.kid === kid);
  if (!key) {
    return yield* new SealedStateTokenError({
      code: "unknown-kid",
      message: "Sealed state token used an unknown key id.",
    });
  }

  return key;
});

const parseTokenParts = Effect.fn("sealedState.parseParts")(function* (
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
    return yield* invalidToken("Invalid sealed state token.");
  }

  return {
    encodedHeader,
    encodedIv,
    encodedCiphertext,
    encodedAuthTag,
  };
});

const parseJson = Effect.fn("sealedState.parseJson")(
  (value: Buffer, message: string) =>
    Effect.try({
      try: () => JSON.parse(textDecoder.decode(value)) as unknown,
      catch: (cause) => invalidToken(message, cause),
    })
);

const stringifyJson = Effect.fn("sealedState.stringifyJson")(<T>(value: T) =>
  Effect.try({
    try: () => JSON.stringify(value),
    catch: (cause) =>
      invalidToken("Sealed state could not be serialized.", cause),
  })
);

const decodeProtectedHeader = Schema.decodeUnknownEffect(
  sealedStateProtectedHeaderSchema,
  { onExcessProperty: "error" }
);

const deriveSyntheticIv = (
  key: Buffer,
  encodedHeader: string,
  plaintext: Buffer
) =>
  createHmac(
    "sha256",
    Buffer.from(
      hkdfSync("sha256", key, Buffer.alloc(0), syntheticIvKeyInfo, 32)
    )
  )
    .update(encodedHeader)
    .update(".")
    .update(plaintext)
    .digest()
    .subarray(0, ivByteLength);

export const sealState = Effect.fn("sealedState.seal")(function* <T>(
  state: T,
  keyId: SealedStateKeyId,
  options: SealedStateOptions = {}
) {
  const key = yield* getSealedStateKeyByKid(keyId, options);
  const headerJson = yield* stringifyJson({
    kid: key.kid,
    ...(options.purpose !== undefined && { purpose: options.purpose }),
    ...(options.compressed === true && { zip: "DEF" }),
  });
  const stateJson = yield* stringifyJson(state);
  const plaintext = options.compressed
    ? yield* Effect.try({
        try: () => deflateRawSync(stateJson),
        catch: (cause) =>
          invalidToken("Sealed state could not be compressed.", cause),
      })
    : Buffer.from(stateJson, "utf8");

  return yield* Effect.try({
    try: () => {
      const encodedHeader = base64UrlEncode(headerJson);
      const iv = options.syntheticIv
        ? deriveSyntheticIv(key.key, encodedHeader, plaintext)
        : (options.randomBytes?.(ivByteLength) ?? randomBytes(ivByteLength));
      const cipher = createCipheriv("aes-256-gcm", key.key, iv, {
        authTagLength: authTagByteLength,
      });

      cipher.setAAD(textEncoder.encode(encodedHeader));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);

      return [
        encodedHeader,
        base64UrlEncode(iv),
        base64UrlEncode(ciphertext),
        base64UrlEncode(cipher.getAuthTag()),
      ].join(".");
    },
    catch: (cause) => invalidToken("Sealed state could not be sealed.", cause),
  });
});

/**
 * Authenticates, decrypts, and decodes sealed state without accepting it as
 * current. Callers may project recovery metadata from expired state, but
 * every operation on the state must continue through `openSealedState`.
 */
export const decodeSealedState = Effect.fn("sealedState.decode")(function* <
  A extends SealedStateClaims,
>(token: string, schema: Schema.Decoder<A>, options: SealedStateOptions = {}) {
  const { encodedHeader, encodedIv, encodedCiphertext, encodedAuthTag } =
    yield* parseTokenParts(token);
  const encodedHeaderBytes = yield* base64UrlDecode(
    encodedHeader,
    "Invalid sealed state token header."
  );
  const headerJson = yield* parseJson(
    encodedHeaderBytes,
    "Invalid sealed state token header."
  );
  const header = yield* decodeProtectedHeader(headerJson).pipe(
    Effect.mapError((cause) =>
      invalidToken("Invalid sealed state token header.", cause)
    )
  );
  if (header.purpose !== options.purpose) {
    return yield* invalidToken("Sealed state token has another purpose.");
  }
  const key = yield* getSealedStateKeyByKid(header.kid, options);
  const [iv, ciphertext, authTag] = yield* Effect.all([
    base64UrlDecode(encodedIv, "Invalid sealed state token."),
    base64UrlDecode(encodedCiphertext, "Invalid sealed state token."),
    base64UrlDecode(encodedAuthTag, "Invalid sealed state token."),
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
    catch: (cause) => invalidToken("Invalid sealed state token.", cause),
  });
  const stateBytes =
    header.zip === "DEF"
      ? yield* Effect.try({
          try: () =>
            inflateRawSync(plaintext, {
              maxOutputLength: maxInflatedStateByteLength,
            }),
          catch: (cause) =>
            invalidToken("Invalid sealed state token payload.", cause),
        })
      : plaintext;
  const stateJson = yield* parseJson(
    stateBytes,
    "Invalid sealed state token payload."
  );
  const state = yield* Schema.decodeUnknownEffect(schema, {
    onExcessProperty: "error",
  })(stateJson).pipe(
    Effect.mapError((cause) =>
      invalidToken("Invalid sealed state token payload.", cause)
    )
  );

  if (state.kid !== header.kid) {
    return yield* invalidToken("Invalid sealed state token payload.");
  }

  return state;
});

export const openSealedState = Effect.fn("sealedState.open")(function* <
  A extends SealedStateClaims,
>(token: string, schema: Schema.Decoder<A>, options: SealedStateOptions = {}) {
  const state = yield* decodeSealedState(token, schema, options);

  const nowMilliseconds = yield* getSealedStateNowMilliseconds(options);
  if (state.exp <= Math.floor(nowMilliseconds / 1000)) {
    return yield* new SealedStateTokenError({
      code: "expired",
      message: "Sealed state token expired.",
    });
  }

  return state;
});

/**
 * A purpose-bound codec for one kind of sealed state: `seal` encodes the
 * value with `schema`, compresses it, and stamps it to expire after
 * `ttlMilliseconds`; `open` accepts only an unexpired token sealed for the
 * same purpose. A token longer than `maxTokenLength` fails to seal with
 * `SealedStateTooLargeError` and doesn't open.
 */
export const makeSealedState = <A, I>({
  purpose,
  schema,
  ttlMilliseconds,
  maxTokenLength,
}: {
  readonly purpose: string;
  readonly schema: Schema.Codec<A, I>;
  readonly ttlMilliseconds: number;
  readonly maxTokenLength: number;
}) => {
  const envelope = Schema.Struct({
    ...sealedStateClaimsSchema.fields,
    value: schema,
  });
  const encodeEnvelope = Schema.encodeEffect(envelope);

  const seal = Effect.fn("sealedState.sealValue")(function* (
    value: A,
    options: SealedStateCryptoOptions = {}
  ) {
    const claims = yield* createSealedStateClaims(ttlMilliseconds, options);
    const encoded = yield* encodeEnvelope({ ...claims, value }).pipe(
      Effect.mapError((cause) =>
        invalidToken("Sealed state could not be encoded.", cause)
      )
    );
    const token = yield* sealState(encoded, claims.kid, {
      ...options,
      purpose,
      compressed: true,
    });
    if (token.length > maxTokenLength) {
      return yield* new SealedStateTooLargeError({
        maxTokenLength,
        tokenLength: token.length,
      });
    }
    return token;
  });

  const open = Effect.fn("sealedState.openValue")(function* (
    token: string,
    options: SealedStateCryptoOptions = {}
  ) {
    if (token.length > maxTokenLength) {
      return yield* invalidToken("Invalid sealed state token.");
    }
    const state = yield* openSealedState(token, envelope, {
      ...options,
      purpose,
    });
    return state.value;
  });

  return { open, seal };
};
