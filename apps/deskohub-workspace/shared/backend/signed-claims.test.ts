import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Data, Effect, Result, Schema } from "effect";
import { makeSignedClaims, type SignedClaimsKeyRing } from "./signed-claims";

// Each golden token is what the reservation access token, reservation access
// cookie and campaign unsubscribe modules issue today for the same claims and
// key; their own tests pin the same strings.
const goldenAccessToken =
  "eyJwdXJwb3NlIjoicmVzZXJ2YXRpb24tYWNjZXNzIiwib3JkZXJJZCI6InJlc2VydmF0aW9uLTEiLCJsb2NhbGUiOiJlbi1VUyIsImlzc3VlZEF0RXBvY2hNaWxsaXNlY29uZHMiOjE3ODE5NDI0MDAwMDB9.bdiqEW-XmvyeCmoctnVagNsr-L4Tm3s0Fym2bp1pD6w";
const goldenAccessCookie =
  "eyJwdXJwb3NlIjoicmVzZXJ2YXRpb24tYWNjZXNzLWNvb2tpZSIsIm9yZGVySWQiOiJyZXNlcnZhdGlvbi1jb29raWUtMSIsImxvY2FsZSI6ImVuLVVTIiwiaXNzdWVkQXRFcG9jaE1pbGxpc2Vjb25kcyI6MTgwMDAwMDAwMDAwMCwiZXhwaXJlc0F0RXBvY2hNaWxsaXNlY29uZHMiOjE4MDAwODY0MDAwMDB9.c3MfbVwwPajdDx1ZJgqAV55ibefyWnryxfZrNYlC88A";
const goldenUnsubscribeToken =
  "WyJzZW5kLTEiLCI0MiJd.766UFxUziQ368Ko3FdnJpEt3Ws48QDR2IULn2-C1aS4";
const goldenRotatedUnsubscribeToken =
  "WyJzZW5kLTEiLCI0MiJd.qjIg7vrg5HqB3qM8x6rCwGTzH2PCVy5C6uvrM5mTX_c";

const accessTokenKey = Buffer.alloc(32, 9);
const accessCookieKey = Buffer.alloc(32, 13);
const currentKey = Buffer.alloc(32, 1);
const previousKey = Buffer.alloc(32, 2);
const otherKey = Buffer.alloc(32, 14);

const accessTokenSchema = Schema.Struct({
  purpose: Schema.Literal("reservation-access"),
  orderId: Schema.String,
  locale: Schema.String,
  issuedAtEpochMilliseconds: Schema.Int,
});
const accessToken = makeSignedClaims({
  purpose: "reservation-access",
  schema: accessTokenSchema,
});
const accessTokenClaims = {
  purpose: "reservation-access",
  orderId: "reservation-1",
  locale: "en-US",
  issuedAtEpochMilliseconds: Date.parse("2026-06-20T08:00:00Z"),
} as const;

const accessCookie = makeSignedClaims({
  purpose: "reservation-access-cookie",
  schema: Schema.Struct({
    purpose: Schema.Literal("reservation-access-cookie"),
    orderId: Schema.String,
    locale: Schema.String,
    issuedAtEpochMilliseconds: Schema.Int,
    expiresAtEpochMilliseconds: Schema.Int,
  }),
});
const accessCookieClaims = {
  purpose: "reservation-access-cookie",
  orderId: "reservation-cookie-1",
  locale: "en-US",
  issuedAtEpochMilliseconds: 1_800_000_000_000,
  expiresAtEpochMilliseconds: 1_800_086_400_000,
} as const;

const unsubscribe = makeSignedClaims({
  purpose: undefined,
  schema: Schema.Tuple([Schema.String, Schema.String]),
});
const unsubscribeClaims = ["send-1", "42"] as const;

class KeysUnavailable extends Data.TaggedError("KeysUnavailable") {}

const ring = (...keys: SignedClaimsKeyRing) => Effect.succeed(keys);
const unavailableKeys = Effect.fail(new KeysUnavailable());

/** The failure code or tag of a run, or "opened" when it succeeds. */
const openFailure = <A>(
  run: Effect.Effect<A, { readonly _tag: string; readonly code?: string }>
) =>
  Result.match(Effect.runSync(Effect.result(run)), {
    onFailure: (error) => error.code ?? error._tag,
    onSuccess: () => "opened",
  });

const encode = (text: string | Uint8Array) =>
  Buffer.from(text).toString("base64url");
/** Signs an arbitrary payload the way the access token format signs it. */
const signAccessTokenPayload = (encodedClaims: string, key = accessTokenKey) =>
  `${encodedClaims}.${createHmac("sha256", key)
    .update(`reservation-access.${encodedClaims}`)
    .digest("base64url")}`;

describe("signed claims", () => {
  test("signs claims to the golden token of each existing format", () => {
    expect(
      Effect.runSync(accessToken.sign(accessTokenClaims, [accessTokenKey]))
    ).toBe(goldenAccessToken);
    expect(
      Effect.runSync(accessCookie.sign(accessCookieClaims, [accessCookieKey]))
    ).toBe(goldenAccessCookie);
    expect(
      Effect.runSync(unsubscribe.sign(unsubscribeClaims, [currentKey]))
    ).toBe(goldenUnsubscribeToken);
    expect(
      Effect.runSync(unsubscribe.sign(unsubscribeClaims, [previousKey]))
    ).toBe(goldenRotatedUnsubscribeToken);
  });

  test("opens the golden token of each existing format", () => {
    expect(
      Effect.runSync(accessToken.open(goldenAccessToken, ring(accessTokenKey)))
    ).toEqual(accessTokenClaims);
    expect(
      Effect.runSync(
        accessCookie.open(goldenAccessCookie, ring(accessCookieKey))
      )
    ).toEqual(accessCookieClaims);
    expect(
      Effect.runSync(unsubscribe.open(goldenUnsubscribeToken, ring(currentKey)))
    ).toEqual(unsubscribeClaims);
  });

  test("signs with the first key and opens with any key of the ring", () => {
    expect(
      Effect.runSync(
        unsubscribe.sign(unsubscribeClaims, [currentKey, previousKey])
      )
    ).toBe(goldenUnsubscribeToken);
    for (const token of [
      goldenUnsubscribeToken,
      goldenRotatedUnsubscribeToken,
    ]) {
      expect(
        Effect.runSync(unsubscribe.open(token, ring(currentKey, previousKey)))
      ).toEqual(unsubscribeClaims);
    }
    expect(
      openFailure(
        unsubscribe.open(goldenRotatedUnsubscribeToken, ring(currentKey))
      )
    ).toBe("forged");
  });

  test("rejects a token signed with another key or for another purpose", () => {
    const [encodedClaims] = goldenAccessToken.split(".");
    const otherPurpose = makeSignedClaims({
      purpose: "reservation-access-cookie",
      schema: accessTokenSchema,
    });
    const bare = makeSignedClaims({
      purpose: undefined,
      schema: accessTokenSchema,
    });

    for (const open of [
      accessToken.open(goldenAccessToken, ring(otherKey)),
      accessToken.open(
        signAccessTokenPayload(encodedClaims ?? "", otherKey),
        ring(accessTokenKey)
      ),
      otherPurpose.open(goldenAccessToken, ring(accessTokenKey)),
      bare.open(goldenAccessToken, ring(accessTokenKey)),
    ]) {
      expect(openFailure(open)).toBe("forged");
    }
  });

  test("rejects altered claims or an altered signature as forged", () => {
    const [encodedClaims, signature = ""] = goldenAccessToken.split(".");
    const alteredClaims = encode(
      JSON.stringify({ ...accessTokenClaims, orderId: "reservation-2" })
    );
    const flipped = Buffer.from(signature, "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 1;

    for (const forged of [
      `${alteredClaims}.${signature}`,
      `${encodedClaims}.${flipped.toString("base64url")}`,
    ]) {
      expect(openFailure(accessToken.open(forged, ring(accessTokenKey)))).toBe(
        "forged"
      );
    }
  });

  test("rejects a token that isn't two canonical base64url parts", () => {
    const [encodedClaims = "", signature = ""] = goldenAccessToken.split(".");
    // The last character of a 32-byte signature carries two unused bits, so
    // a different final character can decode to the same bytes.
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const aliasedSignature = `${signature.slice(0, -1)}${
      alphabet[alphabet.indexOf(signature.at(-1) ?? "") ^ 1]
    }`;
    expect(Buffer.from(aliasedSignature, "base64url")).toEqual(
      Buffer.from(signature, "base64url")
    );

    for (const malformed of [
      "",
      ".",
      encodedClaims,
      `${encodedClaims}.`,
      `.${signature}`,
      `${goldenAccessToken}.extra`,
      `${encodedClaims}.${aliasedSignature}`,
      `${encodedClaims}.${signature}=`,
      `${encodedClaims}.${signature.slice(0, -2)}`,
      `${encodedClaims}.${signature}AA`,
      `${encodedClaims}.${signature.replace(/^./, "+")}`,
      `${encodedClaims}=.${signature}`,
      ` ${goldenAccessToken}`,
    ]) {
      expect(
        openFailure(accessToken.open(malformed, ring(accessTokenKey)))
      ).toBe("malformed");
    }
  });

  test("rejects validly signed claims that don't decode strictly", () => {
    for (const encodedClaims of [
      // An invalid UTF-8 byte inside an otherwise valid JSON string.
      encode(
        Buffer.concat([
          Buffer.from(
            '{"purpose":"reservation-access","orderId":"reservation-'
          ),
          Uint8Array.of(0xff),
          Buffer.from('","locale":"en-US","issuedAtEpochMilliseconds":0}'),
        ])
      ),
      encode("not json"),
      encode(JSON.stringify({ ...accessTokenClaims, extra: true })),
      encode(JSON.stringify({ ...accessTokenClaims, purpose: "other" })),
      encode(
        JSON.stringify({ ...accessTokenClaims, issuedAtEpochMilliseconds: 1.5 })
      ),
      encode(JSON.stringify([accessTokenClaims])),
    ]) {
      expect(
        openFailure(
          accessToken.open(
            signAccessTokenPayload(encodedClaims),
            ring(accessTokenKey)
          )
        )
      ).toBe("malformed");
    }
  });

  test("fails to sign claims its schema rejects", () => {
    expect(
      openFailure(
        accessToken.sign(
          { ...accessTokenClaims, issuedAtEpochMilliseconds: 1.5 },
          [accessTokenKey]
        )
      )
    ).toBe("malformed");
  });

  test("reads the keys only once a token decodes", () => {
    expect(openFailure(accessToken.open("not-a-token", unavailableKeys))).toBe(
      "malformed"
    );
    expect(
      openFailure(accessToken.open(goldenAccessToken, unavailableKeys))
    ).toBe("KeysUnavailable");
  });
});
