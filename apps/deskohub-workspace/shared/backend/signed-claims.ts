import { createHmac, timingSafeEqual } from "node:crypto";
import { Data, Effect, Option, Schema } from "effect";
import { decodeCanonicalBase64Url } from "./canonical-base64url";

/*
 * Claims signed with HMAC-SHA256 for a round trip through the browser, such
 * as a link or a cookie. A token is `base64url(JSON).base64url(MAC)` with no
 * padding; the claims are readable, only their authenticity is protected.
 * Reservation access tokens and cookies and campaign unsubscribe links use
 * this format, so its bytes must not change.
 */

/** Ordered keys: the first signs new claims, and every key verifies. */
export type SignedClaimsKeyRing = readonly [Buffer, ...Buffer[]];

/**
 * Signed claims that can't be signed or opened: the token or its claims are
 * malformed, or no key of the ring signed it for this purpose.
 */
class SignedClaimsError extends Data.TaggedError("SignedClaimsError")<{
  readonly code: "malformed" | "forged";
  readonly message: string;
  readonly cause?: unknown;
}> {}

const signatureByteLength = 32;
const utf8 = new TextDecoder("utf-8", { fatal: true });

const malformed = (message: string, cause?: unknown) =>
  new SignedClaimsError({ code: "malformed", message, cause });

/**
 * A codec for one kind of signed claims. `sign` encodes the claims with
 * `schema` and signs them with the first key of the ring, the same claims
 * always to the same token. `open` accepts only a canonically encoded token
 * whose claims decode with `schema`, with no extra properties, and that a key
 * of the ring signed for the same purpose.
 *
 * With a `purpose`, the MAC covers `purpose.payload`, so a token signed for
 * one purpose never opens for another under the same key. With `undefined`,
 * it covers the bare payload, the format of campaign unsubscribe links.
 *
 * `open` reads the keys only once the token decodes, so a malformed token
 * fails as malformed even when the keys are unavailable.
 */
export const makeSignedClaims = <A, I>({
  purpose,
  schema,
}: {
  readonly purpose: string | undefined;
  readonly schema: Schema.Codec<A, I>;
}) => {
  const json = Schema.fromJsonString(schema);
  const encodeClaims = Schema.encodeEffect(json);
  const decodeClaims = Schema.decodeUnknownEffect(json, {
    onExcessProperty: "error",
  });
  const macInput = (encodedClaims: string) =>
    purpose === undefined ? encodedClaims : `${purpose}.${encodedClaims}`;
  const mac = (key: Buffer, encodedClaims: string) =>
    createHmac("sha256", key).update(macInput(encodedClaims)).digest();

  const sign = Effect.fn("signedClaims.sign")(function* (
    claims: A,
    keys: SignedClaimsKeyRing
  ) {
    const claimsJson = yield* encodeClaims(claims).pipe(
      Effect.mapError((cause) =>
        malformed("Signed claims could not be encoded.", cause)
      )
    );
    const encodedClaims = Buffer.from(claimsJson, "utf8").toString("base64url");
    const [signingKey] = keys;

    return `${encodedClaims}.${mac(signingKey, encodedClaims).toString("base64url")}`;
  });

  const open = Effect.fn("signedClaims.open")(function* <E, R>(
    token: string,
    keys: Effect.Effect<SignedClaimsKeyRing, E, R>
  ) {
    const { encodedClaims, claimsJson, signature } = yield* Effect.fromOption(
      readToken(token)
    ).pipe(
      Effect.mapError(() => malformed("Signed claims token is malformed."))
    );
    const claims = yield* decodeClaims(claimsJson).pipe(
      Effect.mapError((cause) =>
        malformed("Signed claims token is malformed.", cause)
      )
    );
    const ring = yield* keys;
    const authentic = ring.some((key) =>
      timingSafeEqual(mac(key, encodedClaims), signature)
    );
    if (!authentic) {
      return yield* new SignedClaimsError({
        code: "forged",
        message: "Signed claims token has an invalid signature.",
      });
    }

    return claims;
  });

  return { open, sign };
};

const decodeUtf8 = Option.liftThrowable((bytes: Uint8Array) =>
  utf8.decode(bytes)
);

/**
 * The parts of a two-part token: its encoded claims, their JSON text and the
 * signature bytes, or nothing unless both parts are canonical base64url, the
 * claims are UTF-8 and the signature is a SHA-256 MAC long.
 */
const readToken = (token: string) => {
  const [encodedClaims = "", encodedSignature = "", ...extraParts] =
    token.split(".");

  return Option.all({
    encodedClaims: Option.some(encodedClaims),
    claimsJson: decodeCanonicalBase64Url(encodedClaims).pipe(
      Option.flatMap(decodeUtf8)
    ),
    signature: decodeCanonicalBase64Url(encodedSignature).pipe(
      Option.filter((bytes) => bytes.byteLength === signatureByteLength)
    ),
  }).pipe(Option.filter(() => extraParts.length === 0));
};
