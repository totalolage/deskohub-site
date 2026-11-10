import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Predicate, Schema } from "effect";
import type { JsonObject } from "type-fest";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import { buildReservationQuote } from "@/features/checkout/reservation-quote";
import {
  canonicalPromotionCodeSchema,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { reservationOrderSchema } from "@/features/reservation/reservation-order";
import type { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import {
  runSealedState,
  syntheticSealedStateKeyRing,
} from "@/shared/testing/sealed-state-keys.test-utils";
import { instantStringSchema } from "@/shared/utils/temporal";
import type { SignedPayState } from "./pay-state";

const testEmailAddressForAda = testEmailAddress("ada");

mock.module("server-only", () => ({}));

const payStateBookedAt = instantStringSchema.make("2026-06-01T09:58:00.000Z");

const {
  buildSignedPayState,
  getPayStateRestartKind,
  getSignedPayStateSubmittedCodeApplication,
  openPayState,
  payStateTokenQueryParam,
  sealPayState,
  signedPayStateSchema,
} = await import("./pay-state");
const { buildCheckoutPayContinuationPath } = await import("./checkout-pay-url");
const { makeLegacySealedState, sealedStateClaimsSchema } = await import(
  "@/shared/backend/sealed-state"
);

const fixedNow = new Date("2026-06-01T10:00:00.000Z");
const fixedKey = syntheticSealedStateKeyRing(["test-kid", 1]);
const wrongKey = syntheticSealedStateKeyRing(["test-kid", 2]);
const rotatedKey = syntheticSealedStateKeyRing(["rotated-kid", 3]);
const rotatedKid = "rotated-kid";

/** Runs Pay-state work under `fixedKey` at `fixedNow` unless told otherwise. */
const run = <A, E>(
  effect: Effect.Effect<A, E, SealedStateKeys>,
  options: { readonly keys?: string; readonly at?: Date } = {}
) => runSealedState(effect, { keys: fixedKey, at: fixedNow, ...options });
const canonicalCode = Schema.decodeUnknownSync(canonicalPromotionCodeSchema)(
  "SUMMER50"
);
const submittedCodeDiscountId = Schema.decodeUnknownSync(discountIdSchema)(
  "submitted-code-discount"
);
const strictParseOptions = { onExcessProperty: "error" } as const;
const decodeSignedPayState = Schema.decodeUnknownSync(
  signedPayStateSchema,
  strictParseOptions
);
const baseReservation = Schema.decodeUnknownSync(
  normalizedCoworkReservationOrderSchema
)({
  kind: "cowork",
  entryTier: "profi",
  date: "2026-06-20",
  coffee: true,
  monitorOption: "2x27-qhd",
  name: "Ada Lovelace",
  email: testEmailAddressForAda,
  phone: "+420 777 777 777",
});

const buildState = (overrides: Partial<SignedPayState> = {}) => ({
  ...run(
    buildSignedPayState({
      locale: "en-US",
      reservation: baseReservation,
      quote: buildCoworkReservationQuote(baseReservation),
      orderId: "pay-state-test-order-id",
      bookedAt: payStateBookedAt,
      checkoutSessionId: "pay-state-test-checkout-session-id",
      ttlMilliseconds: 10 * 60 * 1000,
    }),
    { keys: fixedKey, at: fixedNow }
  ),
  ...overrides,
});

const buildMeetingRoomState = () => {
  const reservation = Schema.decodeUnknownSync(reservationOrderSchema("CZ"))({
    kind: "meeting-room",
    duration: { unit: "hour", amount: 4 },
    reservationDate: "2099-06-10",
    startsAt: "2099-06-10T08:00:00Z",
    endsAt: "2099-06-10T12:00:00Z",
    name: "Ada Lovelace",
    email: testEmailAddressForAda,
    phone: "+420 777 777 777",
  });
  if (reservation.kind !== "meeting-room") {
    throw new Error("Expected meeting-room reservation");
  }

  return run(
    buildSignedPayState({
      locale: "en-US",
      reservation,
      quote: Effect.runSync(buildReservationQuote(reservation)),
      orderId: "meeting-room-pay-state-test-order-id",
      bookedAt: payStateBookedAt,
    }),
    { keys: fixedKey, at: fixedNow }
  );
};

const seal = (state = buildState()) =>
  run(sealPayState(state), { keys: fixedKey });

const replaceTokenHeader = (
  token: string,
  replace: (header: JsonObject) => JsonObject
) => {
  const [encodedHeader, ...rest] = token.split(".");
  if (!encodedHeader) throw new Error("Unexpected test token shape");

  const header = parseJsonRecord(
    Buffer.from(encodedHeader, "base64url").toString("utf8")
  );

  return [
    Buffer.from(JSON.stringify(replace(header))).toString("base64url"),
    ...rest,
  ].join(".");
};

const parseJsonRecord = (json: string): JsonObject => {
  const parsed = JSON.parse(json);
  if (!Predicate.isObject(parsed) || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }

  return parsed as JsonObject;
};

const tamperCiphertext = (token: string) => {
  const parts = token.split(".");
  const ciphertext = parts[2] ?? "";
  parts[2] = `${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}`;
  return parts.join(".");
};

describe("Pay URL state", () => {
  test("round-trips signed Pay state", () => {
    const state = buildState();
    const token = seal(state);

    expect(run(openPayState(token), { keys: fixedKey, at: fixedNow })).toEqual(
      state
    );
    expect(state.orderId).toBe("pay-state-test-order-id");
    expect(state.checkoutSessionId).toBe("pay-state-test-checkout-session-id");
    expect(state.submittedCode).toBeUndefined();
    expect(token.split(".")).toHaveLength(4);
  });

  test("preserves discount and price-change metadata for meeting-room state", () => {
    const changedKeys = {
      sectionKeys: ["total"],
      itemKeys: ["meeting-room"],
    };

    const opened = run(
      openPayState(
        seal({
          ...buildMeetingRoomState(),
          submittedCode: canonicalCode,
          submittedCodeDiscountId,
          changedKeys,
        })
      ),
      { keys: fixedKey, at: fixedNow }
    );

    expect(opened.reservation.kind).toBe("meeting-room");
    expect(opened.submittedCode).toBe(canonicalCode);
    expect(opened.submittedCodeDiscountId).toBe(submittedCodeDiscountId);
    expect(opened.changedKeys).toEqual(changedKeys);
  });

  test("fails closed when no encryption key is configured", () => {
    expect(() =>
      run(
        buildSignedPayState({
          locale: "en-US",
          reservation: baseReservation,
          quote: buildCoworkReservationQuote(baseReservation),
          orderId: "missing-key-test",
          bookedAt: payStateBookedAt,
        }),
        { keys: "" }
      )
    ).toThrow("kid:base64url-32-byte-key");
  });

  test("rejects expired Pay state while retaining its restart family", () => {
    const token = seal(buildMeetingRoomState());
    const afterExpiry = new Date("2026-06-01T10:11:00.000Z");

    expect(() => run(openPayState(token), { at: afterExpiry })).toThrow(
      "expired"
    );
    expect(run(getPayStateRestartKind(token), { at: afterExpiry })).toBe(
      "meeting-room"
    );
  });

  test("round-trips a requested discount code without an applied pair", () => {
    const requestedCode = Schema.decodeUnknownSync(
      canonicalPromotionCodeSchema
    )("CAMPAIGN10");
    const state = buildState({ requestedDiscountCode: requestedCode });
    const token = seal(state);
    const opened = run(openPayState(token), { keys: fixedKey, at: fixedNow });

    expect(opened).toEqual(state);
    expect(opened.requestedDiscountCode).toBe(requestedCode);
    expect(opened.submittedCode).toBeUndefined();
    expect(opened.submittedCodeDiscountId).toBeUndefined();
    expect(token).not.toContain("CAMPAIGN10");
  });

  test("rejects tampered ciphertext", () => {
    const token = tamperCiphertext(seal());

    expect(() =>
      run(openPayState(token), { keys: fixedKey, at: fixedNow })
    ).toThrow("Invalid Pay state token");
    expect(() =>
      run(getPayStateRestartKind(token), { keys: fixedKey })
    ).toThrow("Invalid Pay state token");
  });

  test("rejects wrong and unknown key ids", () => {
    const token = seal();
    const unknownKidToken = replaceTokenHeader(token, (header) => ({
      ...header,
      kid: "unknown-kid",
    }));

    expect(() =>
      run(openPayState(token), { keys: wrongKey, at: fixedNow })
    ).toThrow("Invalid Pay state token");
    expect(() =>
      run(openPayState(unknownKidToken), { keys: fixedKey, at: fixedNow })
    ).toThrow("unknown key id");
  });

  test("keeps existing tokens readable while rotating to a new active key", () => {
    const oldState = buildState();
    const oldToken = seal(oldState);
    const newState = run(
      buildSignedPayState({
        locale: "en-US",
        reservation: baseReservation,
        quote: buildCoworkReservationQuote(baseReservation),
        orderId: "rotated-key-order-id",
        bookedAt: payStateBookedAt,
      }),
      { keys: `${rotatedKey},${fixedKey}`, at: fixedNow }
    );

    expect(
      run(openPayState(oldToken), {
        keys: `${rotatedKey},${fixedKey}`,
        at: fixedNow,
      })
    ).toEqual(oldState);
    expect(newState.kid).toBe(rotatedKid);
    expect(
      run(
        openPayState(
          run(sealPayState(newState), { keys: `${rotatedKey},${fixedKey}` })
        ),
        { keys: `${rotatedKey},${fixedKey}`, at: fixedNow }
      )
    ).toEqual(newState);
  });

  test("strictly validates generic applied-discount snapshots", () => {
    const state = buildState();
    const validApplication = {
      discount: {
        id: "discount-id",
        label: "Summer sale",
        adjustment: { kind: "percentage" as const, basisPoints: 5000 },
      },
      subtotalBefore: state.quote.payment.undiscountedPrice,
      amount: {
        ...state.quote.payment.undiscountedPrice,
        value: 1,
      },
      subtotalAfter: {
        ...state.quote.payment.undiscountedPrice,
        value: state.quote.payment.undiscountedPrice.value - 1,
      },
    };
    const stateWithDiscount = {
      ...state,
      quote: {
        ...state.quote,
        payment: {
          ...state.quote.payment,
          discounts: [validApplication],
        },
      },
    };
    const invalidAmountState = {
      ...stateWithDiscount,
      quote: {
        ...stateWithDiscount.quote,
        payment: {
          ...stateWithDiscount.quote.payment,
          discounts: [
            {
              ...validApplication,
              amount: { ...validApplication.amount, value: -1 },
            },
          ],
        },
      },
    };
    const providerSpecificState = {
      ...stateWithDiscount,
      quote: {
        ...stateWithDiscount.quote,
        payment: {
          ...stateWithDiscount.quote.payment,
          discounts: [
            {
              ...validApplication,
              discount: {
                ...validApplication.discount,
                providerId: "private-provider-id",
              },
            },
          ],
        },
      },
    };

    expect(() => decodeSignedPayState(stateWithDiscount)).not.toThrow();
    expect(() => decodeSignedPayState(invalidAmountState)).toThrow();
    expect(() => decodeSignedPayState(providerSpecificState)).toThrow();
  });

  test("requires submitted code metadata to occur together", () => {
    expect(() =>
      decodeSignedPayState({
        ...buildState(),
        submittedCode: canonicalCode,
      })
    ).toThrow('at ["submittedCodeDiscountId"]');
    expect(() =>
      decodeSignedPayState({
        ...buildState(),
        submittedCodeDiscountId,
      })
    ).toThrow('at ["submittedCodeDiscountId"]');
  });

  test("does not expose plaintext PII in the encrypted URL token", () => {
    const token = seal(
      buildState({
        submittedCode: canonicalCode,
        submittedCodeDiscountId,
      })
    );

    expect(token).not.toContain(baseReservation.name);
    expect(token).not.toContain(baseReservation.email);
    expect(token).not.toContain(baseReservation.phone);
    expect(token).not.toContain("SUMMER50");
  });

  test("finds the submitted code application by its opaque id rather than position", () => {
    const state = buildState();
    const makeApplication = (id: string, value: number) => ({
      discount: {
        id: Schema.decodeUnknownSync(discountIdSchema)(id),
        label: id,
        adjustment: { kind: "percentage" as const, basisPoints: 1000 },
      },
      subtotalBefore: state.quote.payment.undiscountedPrice,
      amount: {
        ...state.quote.payment.undiscountedPrice,
        value,
      },
      subtotalAfter: {
        ...state.quote.payment.undiscountedPrice,
        value: state.quote.payment.undiscountedPrice.value - value,
      },
    });
    const codeApplication = makeApplication(submittedCodeDiscountId, 1000);
    const laterApplication = makeApplication("later-discount", 500);
    const stateWithLaterDiscount = {
      ...state,
      submittedCode: canonicalCode,
      submittedCodeDiscountId,
      quote: {
        ...state.quote,
        payment: {
          ...state.quote.payment,
          discounts: [codeApplication, laterApplication],
        },
      },
    };

    expect(
      getSignedPayStateSubmittedCodeApplication(stateWithLaterDiscount)
    ).toEqual(codeApplication);
  });

  test("builds a clean payable continuation after price review", () => {
    const reviewState = buildState({
      changedKeys: {
        sectionKeys: ["order", "total"],
        itemKeys: ["product:cowork:profi"],
      },
    });
    const path = run(buildCheckoutPayContinuationPath(reviewState), {
      keys: fixedKey,
      at: fixedNow,
    });
    const token = new URL(path, "https://deskohub.test").searchParams.get(
      payStateTokenQueryParam
    );
    const continued = run(openPayState(token ?? ""), {
      keys: fixedKey,
      at: fixedNow,
    });

    expect(continued.changedKeys).toBeUndefined();
    expect(continued.quote).toEqual(reviewState.quote);
    expect(continued.orderId).toBe(reviewState.orderId);
    expect(continued.submittedCode).toBeUndefined();
    expect(continued.submittedCodeDiscountId).toBeUndefined();
  });
});

// Any record with claims, in the Pay-state token format.
const payStateRecord = makeLegacySealedState({
  schema: Schema.StructWithRest(Schema.Struct(sealedStateClaimsSchema.fields), [
    Schema.Record(Schema.String, Schema.Unknown),
  ]),
  ttlMilliseconds: 10 * 60 * 1000,
});

describe("legacy signed Pay state with a retired customer message", () => {
  const openLegacyPayStateWithMessage = (state: SignedPayState) => {
    const legacyState = {
      ...state,
      reservation: {
        ...state.reservation,
        message: "Private setup note.",
      },
    };
    // Seal below the Pay-state schema so the retired key is already in the token.
    const token = run(payStateRecord.seal(legacyState));

    return {
      legacyState,
      opened: run(openPayState(token), { keys: fixedKey, at: fixedNow }),
      restartKind: run(getPayStateRestartKind(token), { keys: fixedKey }),
    };
  };

  test("restores cowork Pay state from a token with retired message", () => {
    const state = buildState();
    const { legacyState, opened, restartKind } =
      openLegacyPayStateWithMessage(state);

    expect(legacyState.reservation).toHaveProperty(
      "message",
      "Private setup note."
    );
    expect(opened).toEqual(state);
    expect(opened.reservation).not.toHaveProperty("message");
    expect(opened.reservation).toMatchObject({
      kind: "cowork",
      entryTier: "profi",
      date: "2026-06-20",
      coffee: true,
      monitorOption: "2x27-qhd",
    });
    expect(restartKind).toBe("cowork");
  });
});

describe("reservation phone in signed Pay state", () => {
  test("keeps the entered reservation phone text", () => {
    const state = buildState();

    expect(
      run(openPayState(seal(state)), { keys: fixedKey, at: fixedNow })
        .reservation.phone
    ).toBe("+420 777 777 777");
  });

  // Seal below the Pay-state schema, as a token from before a rule change would be.
  const openWithPhone = (
    phone: string,
    locale: SignedPayState["locale"] = "en-US"
  ) => {
    const state = buildState({ locale });
    const token = run(
      payStateRecord.seal({
        ...state,
        reservation: { ...state.reservation, phone },
      })
    );
    return run(openPayState(token), { keys: fixedKey, at: fixedNow });
  };

  test("opens a token whose reservation phone is valid entered text", () => {
    expect(openWithPhone("777 123 456").reservation.phone).toBe("777 123 456");
  });

  test.each(["+420 123 456 789", "777 123 4567", "777 123 456 (mobile)"])(
    "does not open a token whose reservation phone is %p",
    (phone) => {
      expect(() => openWithPhone(phone)).toThrow("Invalid Pay state token");
    }
  );

  test("reads the phone in the region of the token's own locale", () => {
    expect(openWithPhone("0151 23456789", "de-DE").reservation.phone).toBe(
      "0151 23456789"
    );
    expect(() => openWithPhone("0151 23456789", "cs-CZ")).toThrow(
      "Invalid Pay state token"
    );
    expect(() => openWithPhone("0151 234567890123", "de-DE")).toThrow(
      "Invalid Pay state token"
    );
  });

  test("builds and opens a de-DE Pay state with a phone read in Germany", () => {
    const state = run(
      buildSignedPayState({
        locale: "de-DE",
        reservation: { ...baseReservation, phone: "0151 23456789" },
        quote: buildCoworkReservationQuote(baseReservation),
        orderId: "pay-state-test-order-id",
        bookedAt: payStateBookedAt,
        checkoutSessionId: "pay-state-test-checkout-session-id",
        ttlMilliseconds: 10 * 60 * 1000,
      }),
      { keys: fixedKey, at: fixedNow }
    );

    expect(
      run(openPayState(seal(state)), { keys: fixedKey, at: fixedNow })
        .reservation.phone
    ).toBe("0151 23456789");
  });
});
