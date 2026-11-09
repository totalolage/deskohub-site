import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Schema } from "effect";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import {
  canonicalPromotionCodeSchema,
  discountIdSchema,
} from "@/features/discounts";
import {
  makeLegacySealedState,
  sealedStateClaimsSchema,
} from "@/shared/backend/sealed-state";
import type { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import {
  runSealedState,
  syntheticSealedStateKeyRing,
} from "@/shared/testing/sealed-state-keys.test-utils";

const testEmailAddressForAda = testEmailAddress("ada");

mock.module("server-only", () => ({}));

const {
  buildAdvertisedPriceState,
  openAdvertisedPriceState,
  sealAdvertisedPriceState,
} = await import("./advertised-price-state");

const fixedNow = new Date("2026-06-01T10:00:00.000Z");
const fixedKey = syntheticSealedStateKeyRing(["test-kid", 1]);

/** Runs advertised-price work under `fixedKey` at `fixedNow` unless told otherwise. */
const run = <A, E>(
  effect: Effect.Effect<A, E, SealedStateKeys>,
  options: { readonly keys?: string; readonly at?: Date } = {}
) => runSealedState(effect, { keys: fixedKey, at: fixedNow, ...options });
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
  run(
    buildAdvertisedPriceState({
      kind: "cowork",
      locale: "en-US",
      reservation,
      quote,
      ttlMilliseconds: 10 * 60 * 1000,
    }),
    { keys: fixedKey, at: fixedNow }
  );

const seal = (state = buildState()) =>
  run(sealAdvertisedPriceState(state), { keys: fixedKey });

const tamperToken = (token: string) => {
  const parts = token.split(".");
  const ciphertext = parts[2] ?? "";
  parts[2] = `${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}`;
  return parts.join(".");
};

describe("advertised price state", () => {
  test("round-trips a PII-free snapshot", () => {
    const token = seal();
    const opened = run(openAdvertisedPriceState(token), {
      keys: fixedKey,
      at: fixedNow,
    });

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
    const state = run(
      buildAdvertisedPriceState({
        kind: "cowork",
        locale: "en-US",
        reservation,
        quote,
        submittedCode,
        submittedCodeDiscountId,
      }),
      { keys: fixedKey, at: fixedNow }
    );
    const token = seal(state);
    const opened = run(openAdvertisedPriceState(token), {
      keys: fixedKey,
      at: fixedNow,
    });

    expect(opened).toMatchObject({ submittedCode, submittedCodeDiscountId });
    expect(token).not.toContain(submittedCode);
  });

  test("keeps a requested discount code inside the cowork snapshot without an applied pair", async () => {
    const requestedDiscountCode = Schema.decodeUnknownSync(
      canonicalPromotionCodeSchema
    )("CAMPAIGN10");
    const state = run(
      buildAdvertisedPriceState({
        kind: "cowork",
        locale: "en-US",
        reservation,
        quote,
        requestedDiscountCode,
      }),
      { keys: fixedKey, at: fixedNow }
    );
    const token = seal(state);
    const opened = run(openAdvertisedPriceState(token), {
      keys: fixedKey,
      at: fixedNow,
    });

    expect(opened).toMatchObject({ requestedDiscountCode });
    expect(opened.submittedCode).toBeUndefined();
    expect(opened.submittedCodeDiscountId).toBeUndefined();
    expect(token).not.toContain(requestedDiscountCode);
  });

  test("rejects tampering and expiry", () => {
    const token = seal();

    expect(() =>
      run(openAdvertisedPriceState(tamperToken(token)), {
        keys: fixedKey,
        at: fixedNow,
      })
    ).toThrow();
    expect(() =>
      run(openAdvertisedPriceState(token), {
        keys: fixedKey,
        at: new Date("2026-06-01T10:10:00.000Z"),
      })
    ).toThrow("expired");
  });

  test("reports token failures by code and invalid snapshots as invalid tokens", () => {
    const token = seal();

    expect(
      run(openAdvertisedPriceState(token).pipe(Effect.flip), {
        at: new Date("2026-06-01T10:10:00.000Z"),
      })
    ).toMatchObject({
      _tag: "AdvertisedPriceStateTokenError",
      code: "expired",
      message: "Sealed state token expired.",
      cause: { _tag: "SealedStateTokenError", code: "expired" },
    });
    expect(
      run(
        sealAdvertisedPriceState({
          ...buildState(),
          customerEmail: testEmailAddressForAda,
        }).pipe(Effect.flip)
      )
    ).toMatchObject({
      _tag: "AdvertisedPriceStateTokenError",
      code: "invalid-token",
      cause: {
        _tag: "SealedStateTokenError",
        code: "invalid-token",
        cause: { _tag: "SchemaError" },
      },
    });
  });

  test("strictly rejects extra snapshot fields", () => {
    const state = { ...buildState(), customerEmail: testEmailAddressForAda };
    // Seal below the snapshot schema, in the advertised-price token format.
    const token = run(
      makeLegacySealedState({
        schema: Schema.StructWithRest(
          Schema.Struct(sealedStateClaimsSchema.fields),
          [Schema.Record(Schema.String, Schema.Unknown)]
        ),
        ttlMilliseconds: 10 * 60 * 1000,
      }).seal(state)
    );

    expect(() =>
      run(openAdvertisedPriceState(token), { keys: fixedKey, at: fixedNow })
    ).toThrow();
  });
});
