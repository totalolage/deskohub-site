import "@/shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { Effect, Result, Schema } from "effect";
import {
  runSealedState,
  syntheticSealedStateKeyRing,
} from "@/shared/testing/sealed-state-keys.test-utils";
import {
  makeLegacySealedState,
  makeSealedState,
  SealedStateTooLargeError,
  sealedStateClaimsSchema,
} from "./sealed-state";
import type { SealedStateKeys } from "./sealed-state-keys.service";

const activeKeys = syntheticSealedStateKeyRing(["active", 1]);
const rotatedKeys = syntheticSealedStateKeyRing(["rotated", 2]);
const ring = syntheticSealedStateKeyRing(["active", 1], ["rotated", 2]);
const now = new Date("2026-10-17T10:00:00.000Z");
const at = (milliseconds: number) => new Date(now.getTime() + milliseconds);
const ttlMilliseconds = 30 * 60 * 1000;
const maxTokenLength = 1024;

const run = <A, E>(
  effect: Effect.Effect<A, E, SealedStateKeys>,
  options: { readonly keys?: string; readonly at?: Date } = {}
) => runSealedState(effect, { keys: activeKeys, at: now, ...options });
const failureCode = <A>(
  effect: Effect.Effect<A, { readonly code: string }, SealedStateKeys>,
  options: { readonly keys?: string; readonly at?: Date } = {}
): string | undefined =>
  Result.match(run(Effect.result(effect), options), {
    onFailure: ({ code }) => code,
    onSuccess: () => undefined,
  });

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

const selectionSchema = Schema.Struct({
  ...sealedStateClaimsSchema.fields,
  selection: Schema.String,
});
const selectionState = makeLegacySealedState({
  schema: selectionSchema,
  ttlMilliseconds: 10 * 60 * 1000,
});
const issueSelection = (selection: string) =>
  selectionState
    .issueClaims()
    .pipe(Effect.map((claims) => ({ ...claims, selection })));

describe("state sealed in the format that predates purposes", () => {
  test("issues claims with the active key, now or at an explicit instant", () => {
    expect(run(selectionState.issueClaims(), { keys: ring })).toEqual({
      kid: "active",
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(now.getTime() / 1000) + 600,
    });

    // Seconds round down only after the lifetime is added.
    const issuedAt = Temporal.Instant.from("2026-10-17T10:00:00.999Z");
    expect(
      run(selectionState.issueClaims({ issuedAt, ttlMilliseconds: 1001 }), {
        at: at(60_000),
      })
    ).toEqual({
      kid: "active",
      iat: Math.floor(issuedAt.epochMilliseconds / 1000),
      exp: Math.floor((issuedAt.epochMilliseconds + 1001) / 1000),
    });
  });

  test("opens the state until the second it expires", () => {
    const state = run(issueSelection("cowork"));
    const token = run(selectionState.seal(state));

    expect(run(selectionState.open(token), { at: at(599_999) })).toEqual(state);
    expect(failureCode(selectionState.open(token), { at: at(600_000) })).toBe(
      "expired"
    );
  });

  test("inspects authenticated state whether or not it expired", () => {
    const state = run(issueSelection("cowork"));
    const token = run(selectionState.seal(state));
    const [header, iv, ciphertext, tag] = token.split(".");
    const bytes = Buffer.from(ciphertext ?? "", "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tampered = [header, iv, bytes.toString("base64url"), tag].join(".");

    expect(run(selectionState.inspect(token), { at: at(3_600_000) })).toEqual(
      state
    );
    expect(failureCode(selectionState.inspect(tampered))).toBe("invalid-token");
    expect(
      failureCode(selectionState.inspect(token), { keys: rotatedKeys })
    ).toBe("unknown-kid");
  });

  test("seals equal state deterministically to an identical token", () => {
    const state = run(issueSelection("cowork"));
    const first = run(selectionState.seal(state, { deterministic: true }));
    const retry = run(selectionState.seal(state, { deterministic: true }));
    const other = run(
      selectionState.seal(
        { ...state, selection: "meeting-room" },
        { deterministic: true }
      )
    );

    expect(retry).toBe(first);
    expect(run(selectionState.open(first))).toEqual(state);
    expect(other).not.toBe(first);
    expect(other.split(".")[1]).not.toBe(first.split(".")[1]);
  });

  test("uses a random IV unless sealing deterministically", () => {
    const state = run(issueSelection("cowork"));

    expect(run(selectionState.seal(state))).not.toBe(
      run(selectionState.seal(state))
    );
  });

  test("seals under the key the state names and opens with any key of the ring", () => {
    const state = run(issueSelection("cowork"), { keys: rotatedKeys });
    const token = run(selectionState.seal(state), { keys: ring });

    expect(state.kid).toBe("rotated");
    expect(run(selectionState.open(token), { keys: ring })).toEqual(state);
    expect(failureCode(selectionState.open(token))).toBe("unknown-kid");
    expect(failureCode(selectionState.seal(state))).toBe("unknown-kid");
  });

  test("stays apart from purpose-bound state", () => {
    const purposeless = run(selectionState.seal(run(issueSelection("cowork"))));
    const purposeBound = run(contactState.seal(contact));
    const claimsState = makeLegacySealedState({
      schema: sealedStateClaimsSchema,
      ttlMilliseconds,
    });

    expect(failureCode(contactState.open(purposeless))).toBe("invalid-token");
    expect(failureCode(contactState.inspect(purposeless))).toBe(
      "invalid-token"
    );
    expect(failureCode(claimsState.open(purposeBound))).toBe("invalid-token");
  });
});

describe("purpose-bound sealed state", () => {
  test("opens the sealed value until it expires", () => {
    const token = run(contactState.seal(contact));

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
      run(contactState.open(token), { at: at(ttlMilliseconds - 1000) })
    ).toEqual(contact);
    expect(
      failureCode(contactState.open(token), { at: at(ttlMilliseconds) })
    ).toBe("expired");
  });

  test("inspects an expired token without accepting it as current", () => {
    const token = run(contactState.seal(contact));

    expect(
      run(contactState.inspect(token), { at: at(2 * ttlMilliseconds) })
    ).toEqual(contact);
  });

  test("expires a lifetime after an explicit issue instant", () => {
    const issuedAt = Temporal.Instant.fromEpochMilliseconds(
      at(-ttlMilliseconds).getTime()
    );
    const token = run(contactState.seal(contact, { issuedAt }));

    expect(failureCode(contactState.open(token))).toBe("expired");
    expect(
      run(contactState.open(token), { at: at(-ttlMilliseconds + 1000) })
    ).toEqual(contact);
  });

  test("seals deterministically to an identical token", () => {
    const first = run(contactState.seal(contact, { deterministic: true }));

    expect(run(contactState.seal(contact, { deterministic: true }))).toBe(
      first
    );
    expect(run(contactState.seal(contact))).not.toBe(first);
  });

  test("never opens a token sealed for another purpose", () => {
    const otherState = makeSealedState({
      purpose: "test-other",
      schema: contactSchema,
      ttlMilliseconds,
      maxTokenLength,
    });
    const token = run(otherState.seal(contact));

    expect(failureCode(contactState.open(token))).toBe("invalid-token");
    expect(failureCode(contactState.inspect(token))).toBe("invalid-token");
  });

  test("rejects a token whose purpose header was rewritten", () => {
    const token = run(contactState.seal(contact));
    const [, ...rest] = token.split(".");
    const forgedHeader = Buffer.from(
      JSON.stringify({ kid: "active", purpose: "test-other" })
    ).toString("base64url");
    const otherState = makeSealedState({
      purpose: "test-other",
      schema: contactSchema,
      ttlMilliseconds,
      maxTokenLength,
    });

    expect(
      failureCode(otherState.open([forgedHeader, ...rest].join(".")))
    ).toBe("invalid-token");
  });

  test("rejects a tampered ciphertext", () => {
    const token = run(contactState.seal(contact));
    const [header, iv, ciphertext, tag] = token.split(".");
    const bytes = Buffer.from(ciphertext ?? "", "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tampered = [header, iv, bytes.toString("base64url"), tag].join(".");

    expect(failureCode(contactState.open(tampered))).toBe("invalid-token");
    expect(failureCode(contactState.inspect(tampered))).toBe("invalid-token");
  });

  test("seals with the first key and opens with any key of the ring", () => {
    const token = run(contactState.seal(contact), { keys: rotatedKeys });

    expect(run(contactState.open(token), { keys: ring })).toEqual(contact);
    expect(failureCode(contactState.open(token))).toBe("unknown-kid");
  });

  test("rejects a value its schema can't decode", () => {
    const looseState = makeSealedState({
      purpose: "test-contact",
      schema: Schema.Struct({ name: Schema.String }),
      ttlMilliseconds,
      maxTokenLength,
    });
    const token = run(looseState.seal({ name: "Ada" }));

    expect(failureCode(contactState.open(token))).toBe("invalid-token");
  });

  test("compresses the value so repetitive input stays short", () => {
    const longContact = { name: "Ada ".repeat(200), phone: contact.phone };
    const token = run(contactState.seal(longContact));

    expect(token.length).toBeLessThan(maxTokenLength / 2);
    expect(run(contactState.open(token))).toEqual(longContact);
  });

  test("fails to seal a value longer than its token allows", () => {
    const sealed = run(
      Effect.result(
        contactState.seal({ name: incompressibleName, phone: contact.phone })
      )
    );

    expect(Result.isFailure(sealed) && sealed.failure).toBeInstanceOf(
      SealedStateTooLargeError
    );
  });

  test("never opens or inspects a token longer than its kind of state allows", () => {
    const roomyState = makeSealedState({
      purpose: "test-contact",
      schema: contactSchema,
      ttlMilliseconds,
      maxTokenLength: maxTokenLength * 4,
    });
    const token = run(
      roomyState.seal({ name: incompressibleName, phone: contact.phone })
    );

    expect(token.length).toBeGreaterThan(maxTokenLength);
    expect(failureCode(contactState.open(token))).toBe("invalid-token");
    expect(failureCode(contactState.inspect(token))).toBe("invalid-token");
  });
});
