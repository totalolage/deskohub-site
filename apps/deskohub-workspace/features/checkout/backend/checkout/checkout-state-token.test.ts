import { describe, expect, test } from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";
import { Effect, Schema } from "effect";
import { generateSyntheticSecretValues } from "@/shared/testing/synthetic-secrets";
import {
  type CheckoutStateKey,
  checkoutStateClaimsSchema,
  createCheckoutStateClaims,
  getCheckoutStateKeys,
  openCheckoutState,
  parseCheckoutStateKey,
  parseCheckoutStateKeys,
  sealCheckoutState,
} from "./checkout-state-token";

const runSync = <A, E>(effect: Effect.Effect<A, E>) => Effect.runSync(effect);
const getFailure = <A, E>(effect: Effect.Effect<A, E>) =>
  runSync(Effect.flip(effect));
const fixedNow = new Date("2026-06-01T10:00:00.000Z");
const tokenTtlMilliseconds = 10_000;

const stateSchema = Schema.Struct({
  ...checkoutStateClaimsSchema.fields,
  value: Schema.NonEmptyString,
});

const makeKey = (kid: string, value: string): CheckoutStateKey =>
  runSync(parseCheckoutStateKey(kid, value));

const [currentKeyValue, previousKeyValue] = generateSyntheticSecretValues();
const currentKey = makeKey("current", currentKeyValue);
const previousKey = makeKey("previous", previousKeyValue);

const buildState = (
  keys: readonly CheckoutStateKey[] = [currentKey],
  ttlMilliseconds = tokenTtlMilliseconds
) => ({
  ...runSync(
    createCheckoutStateClaims(ttlMilliseconds, {
      keys,
      now: () => fixedNow,
    })
  ),
  value: "synthetic-state",
});

const seal = (
  state = buildState(),
  keys: readonly CheckoutStateKey[] = [currentKey]
) =>
  runSync(
    sealCheckoutState(state, {
      keys,
      randomBytes,
    })
  );

const replacePart = (
  token: string,
  index: number,
  replace: (part: string) => string
) => {
  const parts = token.split(".");
  const part = parts[index];
  if (part === undefined) throw new Error("Unexpected test token shape.");
  parts[index] = replace(part);
  return parts.join(".");
};

const sealWithNonstandardLengths = (input: {
  readonly ivLength: number;
  readonly authTagLength: number;
}) => {
  const state = buildState();
  const encodedHeader = Buffer.from(
    JSON.stringify({ kid: currentKey.kid })
  ).toString("base64url");
  const iv = randomBytes(input.ivLength);
  const cipher = createCipheriv("aes-256-gcm", currentKey.key, iv, {
    authTagLength: input.authTagLength,
  });
  cipher.setAAD(Buffer.from(encodedHeader));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(state), "utf8"),
    cipher.final(),
  ]);

  return [
    encodedHeader,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
};

describe("checkout state token codec", () => {
  test("reads previous AES keys while issuing with the current key", () => {
    const previousState = buildState([previousKey]);
    const previousToken = seal(previousState, [previousKey]);
    const currentState = buildState([currentKey, previousKey]);

    expect(
      runSync(
        openCheckoutState(previousToken, stateSchema, {
          keys: [currentKey, previousKey],
          now: () => fixedNow,
        })
      )
    ).toEqual(previousState);
    expect(currentState.kid).toBe(currentKey.kid);
  });

  test("requires canonical base64url for every token segment", () => {
    const token = seal();

    for (const index of [0, 1, 2, 3]) {
      const failure = getFailure(
        openCheckoutState(
          replacePart(token, index, (part) => `${part}=`),
          stateSchema,
          { keys: [currentKey], now: () => fixedNow }
        )
      );
      expect(failure).toMatchObject({
        _tag: "CheckoutStateTokenError",
        code: "invalid-token",
      });
    }
  });

  test("requires canonical base64url key material", () => {
    const encodedKey = randomBytes(32).toString("base64url");
    const failure = getFailure(
      parseCheckoutStateKey("configured", `${encodedKey}=`)
    );

    expect(failure).toMatchObject({
      _tag: "CheckoutStateTokenError",
      code: "invalid-secret",
    });
    expect(failure.message).not.toContain(encodedKey);
  });

  test("rejects invalid and duplicate key ids in parsed and injected rings", () => {
    const encodedKey = randomBytes(32).toString("base64url");
    const invalidIdFailure = getFailure(
      parseCheckoutStateKey("invalid id", encodedKey)
    );
    const duplicateIdFailure = getFailure(
      parseCheckoutStateKeys(`duplicate:${encodedKey},duplicate:${encodedKey}`)
    );
    const injectedDuplicateFailure = getFailure(
      getCheckoutStateKeys({ keys: [currentKey, currentKey] })
    );
    const injectedInvalidIdFailure = getFailure(
      getCheckoutStateKeys({
        keys: [{ kid: "invalid id", key: randomBytes(32) }],
      })
    );

    for (const failure of [
      invalidIdFailure,
      duplicateIdFailure,
      injectedDuplicateFailure,
      injectedInvalidIdFailure,
    ]) {
      expect(failure).toMatchObject({
        _tag: "CheckoutStateTokenError",
        code: "invalid-secret",
      });
    }
  });

  test.each([
    { ivLength: 11, authTagLength: 16 },
    { ivLength: 13, authTagLength: 16 },
    { ivLength: 12, authTagLength: 15 },
  ])("rejects an authenticated token with IV $ivLength and tag $authTagLength", ({
    ivLength,
    authTagLength,
  }) => {
    const failure = getFailure(
      openCheckoutState(
        sealWithNonstandardLengths({ ivLength, authTagLength }),
        stateSchema,
        { keys: [currentKey], now: () => fixedNow }
      )
    );

    expect(failure).toMatchObject({
      _tag: "CheckoutStateTokenError",
      code: "invalid-token",
      message: "Invalid checkout state token.",
    });
  });

  test("rejects a non-12-byte IV supplied by a sealing implementation", () => {
    const failure = getFailure(
      sealCheckoutState(buildState(), {
        keys: [currentKey],
        randomBytes: (size) => randomBytes(size - 1),
      })
    );

    expect(failure).toMatchObject({
      _tag: "CheckoutStateTokenError",
      code: "invalid-token",
      message: "Checkout state could not be sealed.",
    });
  });

  test("rejects canonical ciphertext tampering with the stable token error", () => {
    const tampered = replacePart(seal(), 2, (part) => {
      const bytes = Buffer.from(part, "base64url");
      bytes[0] = (bytes[0] ?? 0) ^ 1;
      return bytes.toString("base64url");
    });
    const failure = getFailure(
      openCheckoutState(tampered, stateSchema, {
        keys: [currentKey],
        now: () => fixedNow,
      })
    );

    expect(failure).toMatchObject({
      _tag: "CheckoutStateTokenError",
      code: "invalid-token",
      message: "Invalid checkout state token.",
    });
  });

  test("accepts the last second before expiry and rejects the exact boundary", () => {
    const token = seal();

    expect(
      runSync(
        openCheckoutState(token, stateSchema, {
          keys: [currentKey],
          now: () => new Date(fixedNow.getTime() + 9_999),
        })
      )
    ).toEqual(buildState());
    expect(
      getFailure(
        openCheckoutState(token, stateSchema, {
          keys: [currentKey],
          now: () => new Date(fixedNow.getTime() + tokenTtlMilliseconds),
        })
      )
    ).toMatchObject({
      _tag: "CheckoutStateTokenError",
      code: "expired",
      message: "Checkout state token expired.",
    });
  });
});
