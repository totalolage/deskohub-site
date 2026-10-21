import { describe, expect, test } from "bun:test";
import { Effect, Result, Schema } from "effect";
import {
  makeSealedState,
  openSealedState,
  parseSealedStateKey,
  type SealedStateKey,
  SealedStateTooLargeError,
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
const maxTokenLength = 1024;

const contactSchema = Schema.Struct({
  name: Schema.String,
  phone: Schema.String,
});
const contact = { name: "Ada Lovelace", phone: "+420 777 777 777" };
// Scattered CJK characters barely compress.
const incompressibleName = Array.from({ length: 600 }, (_, index) =>
  String.fromCharCode(0x4e00 + ((index * 7919) % 20000))
).join("");

const contactState = makeSealedState({
  purpose: "test-contact",
  schema: contactSchema,
  ttlMilliseconds,
  maxTokenLength,
});

const syntheticIvStateSchema = Schema.Struct({
  kid: sealedStateClaimsSchema.fields.kid,
  iat: sealedStateClaimsSchema.fields.iat,
  exp: sealedStateClaimsSchema.fields.exp,
  selection: Schema.String,
});

const syntheticIvState = {
  kid: activeKey.kid,
  iat: Math.floor(now.getTime() / 1000),
  exp: Math.floor(now.getTime() / 1000) + 600,
  selection: "cowork",
};

describe("synthetic IV sealed state", () => {
  test("seals equal state to an identical token that opens to the state", () => {
    const first = runSync(
      sealState(syntheticIvState, activeKey.kid, {
        keys: [activeKey],
        now: at(0),
        syntheticIv: true,
      })
    );
    const retry = runSync(
      sealState(syntheticIvState, activeKey.kid, {
        keys: [activeKey],
        now: at(0),
        syntheticIv: true,
      })
    );

    expect(retry).toBe(first);
    expect(
      runSync(
        openSealedState(first, syntheticIvStateSchema, {
          keys: [activeKey],
          now: at(0),
        })
      )
    ).toEqual(syntheticIvState);
  });

  test("gives different state a different token and IV", () => {
    const first = runSync(
      sealState(syntheticIvState, activeKey.kid, {
        keys: [activeKey],
        syntheticIv: true,
      })
    );
    const otherState = { ...syntheticIvState, selection: "meeting-room" };
    const other = runSync(
      sealState(otherState, activeKey.kid, {
        keys: [activeKey],
        syntheticIv: true,
      })
    );

    expect(other).not.toBe(first);
    expect(other.split(".")[1]).not.toBe(first.split(".")[1]);
  });

  test("uses a random IV when synthetic IVs are not requested", () => {
    const first = runSync(
      sealState(syntheticIvState, activeKey.kid, { keys: [activeKey] })
    );
    const retry = runSync(
      sealState(syntheticIvState, activeKey.kid, { keys: [activeKey] })
    );

    expect(retry).not.toBe(first);
  });
});

describe("purpose-bound sealed state", () => {
  test("opens the sealed value until it expires", () => {
    const token = runSync(
      contactState.seal(contact, { keys: [activeKey], now: at(0) })
    );

    // Whole field values: random ciphertext can't hold them by chance, the
    // way it can hold a short substring.
    const tokenSegments = token
      .split(".")
      .map((segment) => Buffer.from(segment, "base64url"));
    for (const plaintext of [contact.name, contact.phone]) {
      expect(tokenSegments.some((segment) => segment.includes(plaintext))).toBe(
        false
      );
    }
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
      maxTokenLength,
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
      maxTokenLength,
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
      maxTokenLength,
    });
    const token = runSync(
      looseState.seal({ name: "Ada" }, { keys: [activeKey], now: at(0) })
    );

    expect(
      failureCode(contactState.open(token, { keys: [activeKey], now: at(0) }))
    ).toBe("invalid-token");
  });

  test("compresses the value so repetitive input stays short", () => {
    const longContact = { name: "Ada ".repeat(200), phone: contact.phone };
    const token = runSync(
      contactState.seal(longContact, { keys: [activeKey], now: at(0) })
    );

    expect(token.length).toBeLessThan(maxTokenLength / 2);
    expect(
      runSync(contactState.open(token, { keys: [activeKey], now: at(0) }))
    ).toEqual(longContact);
  });

  test("fails to seal a value longer than its token allows", () => {
    const sealed = runSync(
      Effect.result(
        contactState.seal(
          { name: incompressibleName, phone: contact.phone },
          { keys: [activeKey], now: at(0) }
        )
      )
    );

    expect(Result.isFailure(sealed) && sealed.failure).toBeInstanceOf(
      SealedStateTooLargeError
    );
  });

  test("never opens a token longer than its kind of state allows", () => {
    const roomyState = makeSealedState({
      purpose: "test-contact",
      schema: contactSchema,
      ttlMilliseconds,
      maxTokenLength: maxTokenLength * 4,
    });
    const token = runSync(
      roomyState.seal(
        { name: incompressibleName, phone: contact.phone },
        { keys: [activeKey], now: at(0) }
      )
    );

    expect(token.length).toBeGreaterThan(maxTokenLength);
    expect(
      failureCode(contactState.open(token, { keys: [activeKey], now: at(0) }))
    ).toBe("invalid-token");
  });
});
