import { describe, expect, test } from "bun:test";
import { Effect, Result, Schema } from "effect";
import {
  makeSealedState,
  openSealedState,
  parseSealedStateKey,
  type SealedStateKey,
  sealedStateClaimsSchema,
  sealState,
} from "./sealed-state";

const runSync = <A, E>(effect: Effect.Effect<A, E>) => Effect.runSync(effect);
const failureCode = <A>(
  effect: Effect.Effect<A, { readonly code: string }>
): string | undefined =>
  Result.match(runSync(Effect.result(effect)), {
    onFailure: ({ code }) => code,
    onSuccess: () => undefined,
  });

const key = (kid: string, fill: number): SealedStateKey =>
  runSync(
    parseSealedStateKey(kid, Buffer.alloc(32, fill).toString("base64url"))
  );

const activeKey = key("active", 1);
const rotatedKey = key("rotated", 2);
const now = new Date("2026-10-17T10:00:00.000Z");
const at = (milliseconds: number) => () =>
  new Date(now.getTime() + milliseconds);
const ttlMilliseconds = 30 * 60 * 1000;

const contactSchema = Schema.Struct({
  name: Schema.String,
  phone: Schema.String,
});
const contact = { name: "Ada Lovelace", phone: "+420 777 777 777" };

const contactState = makeSealedState({
  purpose: "test-contact",
  schema: contactSchema,
  ttlMilliseconds,
});

describe("purpose-bound sealed state", () => {
  test("opens the sealed value until it expires", () => {
    const token = runSync(
      contactState.seal(contact, { keys: [activeKey], now: at(0) })
    );

    expect(token).not.toContain("Ada");
    expect(
      runSync(
        contactState.open(token, {
          keys: [activeKey],
          now: at(ttlMilliseconds - 1000),
        })
      )
    ).toEqual(contact);
    expect(
      failureCode(
        contactState.open(token, {
          keys: [activeKey],
          now: at(ttlMilliseconds),
        })
      )
    ).toBe("expired");
  });

  test("never opens a token sealed for another purpose", () => {
    const otherState = makeSealedState({
      purpose: "test-other",
      schema: contactSchema,
      ttlMilliseconds,
    });
    const token = runSync(
      otherState.seal(contact, { keys: [activeKey], now: at(0) })
    );

    expect(
      failureCode(contactState.open(token, { keys: [activeKey], now: at(0) }))
    ).toBe("invalid-token");
  });

  test("keeps purposeless state, such as pay state, apart from purpose-bound state", () => {
    const claimsOnly = {
      kid: activeKey.kid,
      iat: 1_791_000_000,
      exp: 1_791_000_600,
    };
    const purposeless = runSync(
      sealState(claimsOnly, activeKey.kid, { keys: [activeKey] })
    );
    const purposeBound = runSync(
      contactState.seal(contact, { keys: [activeKey], now: at(0) })
    );

    expect(
      failureCode(
        contactState.open(purposeless, { keys: [activeKey], now: at(0) })
      )
    ).toBe("invalid-token");
    expect(
      failureCode(
        openSealedState(purposeBound, sealedStateClaimsSchema, {
          keys: [activeKey],
          now: at(0),
        })
      )
    ).toBe("invalid-token");
  });

  test("rejects a token whose purpose header was rewritten", () => {
    const token = runSync(
      contactState.seal(contact, { keys: [activeKey], now: at(0) })
    );
    const [, ...rest] = token.split(".");
    const forgedHeader = Buffer.from(
      JSON.stringify({ kid: activeKey.kid, purpose: "test-other" })
    ).toString("base64url");
    const otherState = makeSealedState({
      purpose: "test-other",
      schema: contactSchema,
      ttlMilliseconds,
    });

    expect(
      failureCode(
        otherState.open([forgedHeader, ...rest].join("."), {
          keys: [activeKey],
          now: at(0),
        })
      )
    ).toBe("invalid-token");
  });

  test("rejects a tampered ciphertext", () => {
    const token = runSync(
      contactState.seal(contact, { keys: [activeKey], now: at(0) })
    );
    const [header, iv, ciphertext, tag] = token.split(".");
    const bytes = Buffer.from(ciphertext ?? "", "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tampered = [header, iv, bytes.toString("base64url"), tag].join(".");

    expect(
      failureCode(
        contactState.open(tampered, { keys: [activeKey], now: at(0) })
      )
    ).toBe("invalid-token");
  });

  test("seals with the first key and opens with any key of the ring", () => {
    const token = runSync(
      contactState.seal(contact, { keys: [rotatedKey], now: at(0) })
    );

    expect(
      runSync(
        contactState.open(token, { keys: [activeKey, rotatedKey], now: at(0) })
      )
    ).toEqual(contact);
    expect(
      failureCode(contactState.open(token, { keys: [activeKey], now: at(0) }))
    ).toBe("unknown-kid");
  });

  test("rejects a value its schema can't decode", () => {
    const looseState = makeSealedState({
      purpose: "test-contact",
      schema: Schema.Struct({ name: Schema.String }),
      ttlMilliseconds,
    });
    const token = runSync(
      looseState.seal({ name: "Ada" }, { keys: [activeKey], now: at(0) })
    );

    expect(
      failureCode(contactState.open(token, { keys: [activeKey], now: at(0) }))
    ).toBe("invalid-token");
  });
});
