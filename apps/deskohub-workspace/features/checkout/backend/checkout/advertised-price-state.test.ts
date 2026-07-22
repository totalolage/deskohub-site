import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import {
  parseCheckoutStateKey,
  sealCheckoutState,
} from "./checkout-state-token";

mock.module("server-only", () => ({}));

const {
  advertisedPriceStateSchema,
  buildAdvertisedPriceState,
  openAdvertisedPriceState,
  sealAdvertisedPriceState,
} = await import("./advertised-price-state");

const fixedNow = new Date("2026-06-01T10:00:00.000Z");
const fixedKey = Effect.runSync(
  parseCheckoutStateKey("test-kid", Buffer.alloc(32, 1).toString("base64url"))
);
const fixedRandomBytes = (byteLength: number) => Buffer.alloc(byteLength, 7);
const reservation = {
  kind: "cowork" as const,
  details: {
    kind: "cowork" as const,
    entryTier: "basic" as const,
    coffee: true,
    date: "2026-06-20",
  },
};
const quote = buildCoworkReservationQuote(reservation.details);

const buildState = () =>
  Effect.runSync(
    buildAdvertisedPriceState(
      {
        locale: "en-US",
        reservation,
        quote,
        ttlMilliseconds: 10 * 60 * 1000,
      },
      { keys: [fixedKey], now: () => fixedNow }
    )
  );

const seal = (state = buildState()) =>
  Effect.runSync(
    sealAdvertisedPriceState(state, {
      keys: [fixedKey],
      randomBytes: fixedRandomBytes,
    })
  );

const tamperToken = (token: string) => {
  const parts = token.split(".");
  const ciphertext = parts[2] ?? "";
  parts[2] = `${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}`;
  return parts.join(".");
};

describe("advertised price state", () => {
  test("round-trips a PII-free snapshot", () => {
    const token = seal();
    const opened = Effect.runSync(
      openAdvertisedPriceState(token, {
        keys: [fixedKey],
        now: () => fixedNow,
      })
    );

    expect(opened).toEqual(buildState());
    expect(JSON.stringify(opened)).not.toMatch(/name|email|phone|message/i);
    expect(token).not.toContain("2026-06-20");
  });

  test("rejects tampering and expiry", () => {
    const token = seal();

    expect(() =>
      Effect.runSync(
        openAdvertisedPriceState(tamperToken(token), {
          keys: [fixedKey],
          now: () => fixedNow,
        })
      )
    ).toThrow();
    expect(() =>
      Effect.runSync(
        openAdvertisedPriceState(token, {
          keys: [fixedKey],
          now: () => new Date("2026-06-01T10:10:00.000Z"),
        })
      )
    ).toThrow("expired");
  });

  test("strictly rejects extra snapshot fields", () => {
    const state = { ...buildState(), customerEmail: "ada@example.test" };
    const token = Effect.runSync(
      sealCheckoutState(state, {
        keys: [fixedKey],
        randomBytes: fixedRandomBytes,
      })
    );

    expect(() =>
      Effect.runSync(
        openAdvertisedPriceState(token, {
          keys: [fixedKey],
          now: () => fixedNow,
        })
      )
    ).toThrow();
    expect(advertisedPriceStateSchema.fields).not.toHaveProperty(
      "customerEmail"
    );
  });
});
