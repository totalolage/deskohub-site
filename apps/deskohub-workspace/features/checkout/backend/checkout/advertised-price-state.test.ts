import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { Effect, Schema } from "effect";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import {
  canonicalPromotionCodeSchema,
  discountIdSchema,
} from "@/features/discounts";
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
const meetingRoomReservation = {
  kind: "meeting-room" as const,
  details: {
    kind: "meeting-room" as const,
    duration: { unit: "hour" as const, amount: 4 },
    reservationDate: "2026-06-21",
  },
};

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

  test("keeps a requested discount code inside the meeting-room snapshot without an applied pair", async () => {
    const { buildReservationQuote } = await import(
      "@/features/checkout/reservation-quote"
    );
    const { reservationOrderSchema } = await import(
      "@/features/reservation/reservation-order"
    );
    const order = Schema.decodeUnknownSync(reservationOrderSchema)({
      kind: "meeting-room",
      duration: { unit: "hour", amount: 4 },
      reservationDate: "2099-06-10",
      startsAt: "2099-06-10T08:00:00Z",
      endsAt: "2099-06-10T12:00:00Z",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 777 777",
    });
    if (order.kind !== "meeting-room") {
      throw new Error("Expected meeting-room reservation");
    }
    const requestedDiscountCode = Schema.decodeUnknownSync(
      canonicalPromotionCodeSchema
    )("MEET20");
    const meetingRoomQuote = Effect.runSync(buildReservationQuote(order));
    const state = Effect.runSync(
      buildAdvertisedPriceState(
        {
          kind: "meeting-room",
          locale: "en-US",
          reservation: meetingRoomReservation,
          quote: meetingRoomQuote,
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

  test("rejects non-canonical requested discount codes", () => {
    const state = {
      ...buildState(),
      requestedDiscountCode: " campaign10 ",
    };

    expect(() =>
      Schema.decodeUnknownSync(advertisedPriceStateSchema, {
        onExcessProperty: "error",
      })(state)
    ).toThrow('at ["requestedDiscountCode"]');
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
      sealCheckoutState(state, state.kid, {
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
