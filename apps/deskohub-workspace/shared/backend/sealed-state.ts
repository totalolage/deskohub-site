import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { Clock, Effect, Schema } from "effect";
import {
  SealedStateTokenError,
  SealedStateTooLargeError,
} from "./sealed-state-error";
import {
  type SealedStateKeyId,
  SealedStateKeys,
  sealedStateKeyIdSchema,
} from "./sealed-state-keys.service";

/*
 * Short-lived state sealed with AES-256-GCM for a round trip through the
 * browser, such as a URL parameter. Every token is encrypted and
 * authenticated with the first key of the `SealedStateKeys` ring and opens
 * with any key of it, so key rotation follows the checkout key ring.
 */

export {
  SealedStateTokenError,
  SealedStateTooLargeError,
} from "./sealed-state-error";
export {
  type SealedStateKeyId,
  sealedStateKeyIdSchema,
} from "./sealed-state-keys.service";

export const sealedStateClaimsSchema = Schema.Struct({
  kid: sealedStateKeyIdSchema,
  iat: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  exp: Schema.Int.check(Schema.isGreaterThan(0)),
});

export type SealedStateClaims = typeof sealedStateClaimsSchema.Type;

export type SealedStateIssueOptions = {
  /**
   * Issues the state as of this instant instead of now, so it expires a
   * lifetime after it. A link anchored at a booking instant uses it.
   */
  readonly issuedAt?: Temporal.Instant;
};

export type SealedStateSealOptions = {
  /**
   * Seals equal state under one key to the same token, for a link a repeated
   * request must return unchanged. The IV is a 96-bit MAC of the header and
   * plaintext (a synthetic IV, as in SIV), so different states get unrelated
   * IVs; the token reveals only that two seals carried equal state.
   */
  readonly deterministic?: boolean;
};

/**
 * A purpose-bound codec for one kind of sealed state: `seal` encodes the
 * value with `schema`, compresses it, and stamps it to expire after
 * `ttlMilliseconds`; `open` accepts only an unexpired token sealed for the
 * same purpose, and `inspect` authenticates and decodes one without
 * requiring it to be current. A token longer than `maxTokenLength` fails to
 * seal with `SealedStateTooLargeError` and doesn't open.
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
  const format: SealedStateFormat = { purpose, compressed: true };

  const seal = Effect.fn("sealedState.sealValue")(function* (
    value: A,
    options: SealedStateIssueOptions & SealedStateSealOptions = {}
  ) {
    const claims = yield* issueSealedStateClaims(ttlMilliseconds, options);
    const encoded = yield* encodeEnvelope({ ...claims, value }).pipe(
      Effect.mapError((cause) =>
        invalidToken("Sealed state could not be encoded.", cause)
      )
    );
    const token = yield* sealPayload(encoded, claims.kid, format, options);
    if (token.length > maxTokenLength) {
      return yield* new SealedStateTooLargeError({
        maxTokenLength,
        tokenLength: token.length,
      });
    }
    return token;
  });

  const inspectEnvelope = Effect.fn("sealedState.inspectEnvelope")(function* (
    token: string
  ) {
    if (token.length > maxTokenLength) {
      return yield* invalidToken("Invalid sealed state token.");
    }
    return yield* authenticatePayload(token, envelope, format);
  });

  const inspect = Effect.fn("sealedState.inspectValue")((token: string) =>
    inspectEnvelope(token).pipe(Effect.map(({ value }) => value))
  );

  const open = Effect.fn("sealedState.openValue")((token: string) =>
    inspectEnvelope(token).pipe(
      Effect.flatMap(requireUnexpired),
      Effect.map(({ value }) => value)
    )
  );

  return { inspect, open, seal };
};

/**
 * A codec for sealed state in the format that predates purposes: the claims
 * are fields of the state itself, the header carries only the key ID, and
 * the plaintext isn't compressed. Pay and advertised-price state use it, and
 * their tokens live in open Pay pages and agent links, so its bytes must not
 * change. Build the state with claims from `issueClaims`, then `seal` it
 * under the key its `kid` names; `open` accepts only an unexpired token, and
 * `inspect` authenticates and decodes one without requiring it to be current.
 */
export const makeLegacySealedState = <A extends SealedStateClaims, I>({
  schema,
  ttlMilliseconds,
}: {
  readonly schema: Schema.Codec<A, I>;
  readonly ttlMilliseconds: number;
}) => {
  const encodeState = Schema.encodeUnknownEffect(schema, {
    onExcessProperty: "error",
  });
  const format: SealedStateFormat = {};

  const issueClaims = Effect.fn("sealedState.issueClaims")(
    (
      options: SealedStateIssueOptions & {
        readonly ttlMilliseconds?: number;
      } = {}
    ) =>
      issueSealedStateClaims(
        options.ttlMilliseconds ?? ttlMilliseconds,
        options
      )
  );

  const seal = Effect.fn("sealedState.sealState")(function* (
    state: A,
    options: SealedStateSealOptions = {}
  ) {
    const encoded = yield* encodeState(state).pipe(
      Effect.mapError((cause) =>
        invalidToken("Sealed state could not be encoded.", cause)
      )
    );
    return yield* sealPayload(encoded, state.kid, format, options);
  });

  const inspect = Effect.fn("sealedState.inspectState")((token: string) =>
    authenticatePayload(token, schema, format)
  );

  const open = Effect.fn("sealedState.openState")((token: string) =>
    inspect(token).pipe(Effect.flatMap(requireUnexpired))
  );

  return { inspect, issueClaims, open, seal };
};

/** What the protected header of a kind of sealed state carries. */
type SealedStateFormat = {
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

const ivByteLength = 12;
const syntheticIvKeyInfo = "deskohub sealed-state synthetic IV";
const authTagByteLength = 16;
// Far above any state that fits a URL, so a crafted token can't inflate into
// a large allocation.
const maxInflatedStateByteLength = 64 * 1024;

// The header is the additional authenticated data, so the purpose can't be
// changed without failing authentication.
const sealedStateProtectedHeaderSchema = Schema.Struct({
  kid: sealedStateClaimsSchema.fields.kid,
  purpose: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  // JWE's `zip` header (RFC 7516): the plaintext is DEFLATE-compressed.
  zip: Schema.optional(Schema.Literal("DEF")),
});

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const invalidToken = (message: string, cause?: unknown) =>
  new SealedStateTokenError({ code: "invalid-token", message, cause });

const issueSealedStateClaims = Effect.fn("sealedState.issueSealedStateClaims")(
  function* (ttlMilliseconds: number, options: SealedStateIssueOptions) {
    const {
      ring: [activeKey],
    } = yield* SealedStateKeys;
    const issuedAtMilliseconds =
      options.issuedAt?.epochMilliseconds ?? (yield* Clock.currentTimeMillis);

    return yield* Schema.decodeUnknownEffect(sealedStateClaimsSchema)({
      kid: activeKey.kid,
      iat: Math.floor(issuedAtMilliseconds / 1000),
      exp: Math.floor((issuedAtMilliseconds + ttlMilliseconds) / 1000),
    }).pipe(
      Effect.mapError((cause) =>
        invalidToken("Sealed state claims are invalid.", cause)
      )
    );
  }
);

const requireUnexpired = Effect.fn("sealedState.requireUnexpired")(function* <
  A extends SealedStateClaims,
>(state: A) {
  const nowMilliseconds = yield* Clock.currentTimeMillis;
  if (state.exp <= Math.floor(nowMilliseconds / 1000)) {
    return yield* new SealedStateTokenError({
      code: "expired",
      message: "Sealed state token expired.",
    });
  }

  return state;
});

const getSealedStateKey = Effect.fn("sealedState.getKey")(function* (
  kid: SealedStateKeyId
) {
  const { ring } = yield* SealedStateKeys;
  const key = ring.find((candidate) => candidate.kid === kid);
  if (!key) {
    return yield* new SealedStateTokenError({
      code: "unknown-kid",
      message: "Sealed state token used an unknown key id.",
    });
  }

  return key;
});

const sealPayload = Effect.fn("sealedState.seal")(function* <T>(
  payload: T,
  kid: SealedStateKeyId,
  format: SealedStateFormat,
  options: SealedStateSealOptions
) {
  const key = yield* getSealedStateKey(kid);
  const headerJson = yield* stringifyJson({
    kid: key.kid,
    ...(format.purpose !== undefined && { purpose: format.purpose }),
    ...(format.compressed === true && { zip: "DEF" }),
  });
  const payloadJson = yield* stringifyJson(payload);
  const plaintext = format.compressed
    ? yield* Effect.try({
        try: () => deflateRawSync(payloadJson),
        catch: (cause) =>
          invalidToken("Sealed state could not be compressed.", cause),
      })
    : Buffer.from(payloadJson, "utf8");

  return yield* Effect.try({
    try: () => {
      const encodedHeader = base64UrlEncode(headerJson);
      const iv = options.deterministic
        ? deriveSyntheticIv(key.key, encodedHeader, plaintext)
        : randomBytes(ivByteLength);
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
 * current: a token sealed for another purpose, with a key outside the ring,
 * tampered with, or whose payload names another key fails.
 */
const authenticatePayload = Effect.fn("sealedState.authenticate")(function* <
  A extends SealedStateClaims,
>(token: string, schema: Schema.Decoder<A>, format: SealedStateFormat) {
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
  if (header.purpose !== format.purpose) {
    return yield* invalidToken("Sealed state token has another purpose.");
  }
  const key = yield* getSealedStateKey(header.kid);
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
  const payloadBytes =
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
  const payloadJson = yield* parseJson(
    payloadBytes,
    "Invalid sealed state token payload."
  );
  const state = yield* Schema.decodeUnknownEffect(schema, {
    onExcessProperty: "error",
  })(payloadJson).pipe(
    Effect.mapError((cause) =>
      invalidToken("Invalid sealed state token payload.", cause)
    )
  );

  if (state.kid !== header.kid) {
    return yield* invalidToken("Invalid sealed state token payload.");
  }

  return state;
});

const base64UrlEncode = (bytes: Buffer | Uint8Array | string) =>
  Buffer.from(bytes).toString("base64url");

const base64UrlDecode = Effect.fn("sealedState.base64UrlDecode")(
  (value: string, message: string) =>
    Effect.try({
      try: () => Buffer.from(value, "base64url"),
      catch: (cause) => invalidToken(message, cause),
    })
);

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
