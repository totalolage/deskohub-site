import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Schema } from "effect";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import {
  canonicalPromotionCodeSchema,
  discountIdSchema,
} from "@/features/discounts";
import { parseSealedStateKey, sealState } from "@/shared/backend/sealed-state";

const testEmailAddressForAda = testEmailAddress("ada");

mock.module("server-only", () => ({}));

const {
  buildAdvertisedPriceState,
  openAdvertisedPriceState,
  sealAdvertisedPriceState,
} = await import("./advertised-price-state");

const fixedNow = new Date("2026-06-01T10:00:00.000Z");
const fixedKey = Effect.runSync(
  parseSealedStateKey("test-kid", Buffer.alloc(32, 1).toString("base64url"))
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
        kind: "cowork",
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

  test("keeps an advertised query code inside the encrypted snapshot", () => {
    const submittedCode = Schema.decodeUnknownSync(
      canonicalPromotionCodeSchema
    )("CAMPAIGN10");
    const submittedCodeDiscountId =
      Schema.decodeUnknownSync(discountIdSchema)("campaign-discount");
    const state = Effect.runSync(
      buildAdvertisedPriceState(
        {
          kind: "cowork",
          locale: "en-US",
          reservation,
          quote,
          submittedCode,
          submittedCodeDiscountId,
        },
        { keys: [fixedKey], now: () => fixedNow }
      )
    );
    const token = seal(state);
    const opened = Effect.runSync(
      openAdvertisedPriceState(token, {
        keys: [fixedKey],
        now: () => fixedNow,
      })
    );

    expect(opened).toMatchObject({ submittedCode, submittedCodeDiscountId });
    expect(token).not.toContain(submittedCode);
  });

  test("keeps a requested discount code inside the cowork snapshot without an applied pair", async () => {
    const requestedDiscountCode = Schema.decodeUnknownSync(
      canonicalPromotionCodeSchema
    )("CAMPAIGN10");
    const state = Effect.runSync(
      buildAdvertisedPriceState(
        {
          kind: "cowork",
          locale: "en-US",
          reservation,
          quote,
          requestedDiscountCode,
        },
        { keys: [fixedKey], now: () => fixedNow }
      )
    );
    const token = seal(state);
    const opened = Effect.runSync(
      openAdvertisedPriceState(token, {
        keys: [fixedKey],
        now: () => fixedNow,
      })
    );

    expect(opened).toMatchObject({ requestedDiscountCode });
    expect(opened.submittedCode).toBeUndefined();
    expect(opened.submittedCodeDiscountId).toBeUndefined();
    expect(token).not.toContain(requestedDiscountCode);
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

  test("reports token failures by code and invalid snapshots as invalid tokens", () => {
    const token = seal();

    expect(
      Effect.runSync(
        openAdvertisedPriceState(token, {
          keys: [fixedKey],
          now: () => new Date("2026-06-01T10:10:00.000Z"),
        }).pipe(Effect.flip)
      )
    ).toMatchObject({
      _tag: "AdvertisedPriceStateTokenError",
      code: "expired",
      message: "Sealed state token expired.",
      cause: { _tag: "SealedStateTokenError", code: "expired" },
    });
    expect(
      Effect.runSync(
        sealAdvertisedPriceState(
          { ...buildState(), customerEmail: testEmailAddressForAda },
          { keys: [fixedKey], randomBytes: fixedRandomBytes }
        ).pipe(Effect.flip)
      )
    ).toMatchObject({
      _tag: "AdvertisedPriceStateTokenError",
      code: "invalid-token",
      message: "Invalid advertised price state.",
      cause: { _tag: "SchemaError" },
    });
  });

  test("strictly rejects extra snapshot fields", () => {
    const state = { ...buildState(), customerEmail: testEmailAddressForAda };
    const token = Effect.runSync(
      sealState(state, state.kid, {
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
  });
});
