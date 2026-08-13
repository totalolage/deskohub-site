import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { Effect, Predicate, Schema } from "effect";
import type { JsonObject } from "type-fest";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import { buildReservationQuote } from "@/features/checkout/reservation-quote";
import {
  canonicalDiscountCodeSchema,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { reservationOrderSchema } from "@/features/reservation/reservation-order";
import { getReservationStartPath } from "@/features/reservation/routes";
import type { PayStateKey, SignedPayState } from "./pay-state";

mock.module("server-only", () => ({}));

const {
  buildPayStateQueryParams,
  buildSignedPayState,
  getPayStateRestartKind,
  getSignedPayStateSubmittedCodeApplication,
  openPayState,
  parsePayStateKey,
  payStateTokenQueryParam,
  sealPayState,
  sealPayStateForUrl,
  signedPayStateSchema,
} = await import("./pay-state");
const { buildCheckoutPayContinuationPath, buildCheckoutPayPath } = await import(
  "./checkout-pay-url"
);

const runSync = <A, E>(effect: Effect.Effect<A, E>) => Effect.runSync(effect);

const fixedNow = new Date("2026-06-01T10:00:00.000Z");
const fixedKey: PayStateKey = runSync(
  parsePayStateKey("test-kid", Buffer.alloc(32, 1).toString("base64url"))
);
const wrongKey: PayStateKey = runSync(
  parsePayStateKey("test-kid", Buffer.alloc(32, 2).toString("base64url"))
);
const rotatedKey: PayStateKey = runSync(
  parsePayStateKey("rotated-kid", Buffer.alloc(32, 3).toString("base64url"))
);
const fixedRandomBytes = (byteLength: number) => Buffer.alloc(byteLength, 7);
const canonicalCode = Schema.decodeUnknownSync(canonicalDiscountCodeSchema)(
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
  email: "ada@example.com",
  phone: "+420 777 777 777",
  message: "Private setup note.",
});

const buildState = (overrides: Partial<SignedPayState> = {}) => ({
  ...runSync(
    buildSignedPayState(
      {
        locale: "en-US",
        reservation: baseReservation,
        quote: buildCoworkReservationQuote(baseReservation),
        orderId: "pay-state-test-order-id",
        checkoutSessionId: "pay-state-test-checkout-session-id",
        ttlMilliseconds: 10 * 60 * 1000,
      },
      { keys: [fixedKey], now: () => fixedNow }
    )
  ),
  ...overrides,
});

const buildMeetingRoomState = () => {
  const reservation = Schema.decodeUnknownSync(reservationOrderSchema)({
    kind: "meeting-room",
    duration: { unit: "hour", amount: 4 },
    reservationDate: "2099-06-10",
    startsAt: "2099-06-10T08:00:00Z",
    endsAt: "2099-06-10T12:00:00Z",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+420 777 777 777",
  });
  if (reservation.kind !== "meeting-room") {
    throw new Error("Expected meeting-room reservation");
  }

  return runSync(
    buildSignedPayState(
      {
        locale: "en-US",
        reservation,
        quote: Effect.runSync(buildReservationQuote(reservation)),
        orderId: "meeting-room-pay-state-test-order-id",
      },
      { keys: [fixedKey], now: () => fixedNow }
    )
  );
};

const seal = (state = buildState()) =>
  runSync(
    sealPayState(state, { keys: [fixedKey], randomBytes: fixedRandomBytes })
  );

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
  test("does not expose a temporary reservation-family rejection gate", async () => {
    const payState = await import("./pay-state");

    expect(payState).not.toHaveProperty("isCoworkSignedPayState");
  });

  test("round-trips signed Pay state", () => {
    const state = buildState();
    const token = seal(state);

    expect(
      runSync(openPayState(token, { keys: [fixedKey], now: () => fixedNow }))
    ).toEqual(state);
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

    const state = {
      ...buildMeetingRoomState(),
      submittedCode: canonicalCode,
      submittedCodeDiscountId,
      changedKeys,
    };

    expect(state.submittedCode).toBe(canonicalCode);
    expect(state.changedKeys).toEqual(changedKeys);
  });

  test("derives the meeting-room restart path from sealed Pay state", () => {
    const sealedState = runSync(
      sealPayStateForUrl(buildMeetingRoomState(), {
        keys: [fixedKey],
        randomBytes: fixedRandomBytes,
      })
    );
    const url = new URL(
      buildCheckoutPayPath("en-US", sealedState),
      "https://deskohub.test"
    );
    const token = url.searchParams.get(payStateTokenQueryParam);
    if (!token) throw new Error("Expected sealed Pay state in the URL");
    const openedState = runSync(
      openPayState(token, { keys: [fixedKey], now: () => fixedNow })
    );

    expect(url.searchParams.has("reservationKind")).toBeFalse();
    expect(getReservationStartPath("en-US", openedState.reservation.kind)).toBe(
      "/en-US/reservation/meeting-room"
    );
  });

  test("omits redundant payload markers from signed Pay state", () => {
    const state = buildState();

    expect(state).not.toHaveProperty("type");
    expect(state).not.toHaveProperty("schema");
  });

  test("fails closed when no encryption key is configured", () => {
    expect(() =>
      runSync(
        buildSignedPayState(
          {
            locale: "en-US",
            reservation: baseReservation,
            quote: buildCoworkReservationQuote(baseReservation),
            orderId: "missing-key-test",
          },
          { keys: [] }
        )
      )
    ).toThrow("At least one");
  });

  test("rejects expired Pay state while retaining its restart family", () => {
    const token = seal(buildMeetingRoomState());
    const expiredOptions = {
      keys: [fixedKey],
      now: () => new Date("2026-06-01T10:11:00.000Z"),
    };

    expect(() => runSync(openPayState(token, expiredOptions))).toThrow(
      "expired"
    );
    expect(runSync(getPayStateRestartKind(token, expiredOptions))).toBe(
      "meeting-room"
    );
  });

  test("rejects tampered ciphertext", () => {
    const token = tamperCiphertext(seal());

    expect(() =>
      runSync(openPayState(token, { keys: [fixedKey], now: () => fixedNow }))
    ).toThrow("Invalid Pay state token");
    expect(() =>
      runSync(getPayStateRestartKind(token, { keys: [fixedKey] }))
    ).toThrow("Invalid Pay state token");
  });

  test("rejects wrong and unknown key ids", () => {
    const token = seal();
    const unknownKidToken = replaceTokenHeader(token, (header) => ({
      ...header,
      kid: "unknown-kid",
    }));

    expect(() =>
      runSync(openPayState(token, { keys: [wrongKey], now: () => fixedNow }))
    ).toThrow("Invalid Pay state token");
    expect(() =>
      runSync(
        openPayState(unknownKidToken, { keys: [fixedKey], now: () => fixedNow })
      )
    ).toThrow("unknown key id");
  });

  test("keeps existing tokens readable while rotating to a new active key", () => {
    const oldState = buildState();
    const oldToken = seal(oldState);
    const newState = runSync(
      buildSignedPayState(
        {
          locale: "en-US",
          reservation: baseReservation,
          quote: buildCoworkReservationQuote(baseReservation),
          orderId: "rotated-key-order-id",
        },
        { keys: [rotatedKey, fixedKey], now: () => fixedNow }
      )
    );

    expect(
      runSync(
        openPayState(oldToken, {
          keys: [rotatedKey, fixedKey],
          now: () => fixedNow,
        })
      )
    ).toEqual(oldState);
    expect(newState.kid).toBe(rotatedKey.kid);
    expect(
      runSync(
        openPayState(
          runSync(
            sealPayState(newState, {
              keys: [rotatedKey, fixedKey],
              randomBytes: fixedRandomBytes,
            })
          ),
          { keys: [rotatedKey, fixedKey], now: () => fixedNow }
        )
      )
    ).toEqual(newState);
  });

  test("rejects old prefixed and versioned token headers", () => {
    expect(() =>
      runSync(
        openPayState(`dhp1.${seal()}`, {
          keys: [fixedKey],
          now: () => fixedNow,
        })
      )
    ).toThrow("Invalid Pay state token");

    const versionedToken = replaceTokenHeader(seal(), (header) => ({
      ...header,
      v: 1,
      alg: "A256GCM",
    }));

    expect(() =>
      runSync(
        openPayState(versionedToken, {
          keys: [fixedKey],
          now: () => fixedNow,
        })
      )
    ).toThrow("Invalid Pay state token header");
  });

  test("rejects old versioned signed, quote, and summary shapes", () => {
    const state = buildState();
    const oldSignedState = {
      ...state,
      schemaVersion: 1,
      alg: "A256GCM",
      quote: {
        ...state.quote,
        schemaVersion: 1,
        summary: { schemaVersion: 1 },
      },
    };
    expect(() => decodeSignedPayState(oldSignedState)).toThrow();
    expect(() =>
      runSync(
        sealPayState(oldSignedState as SignedPayState, {
          keys: [fixedKey],
        })
      )
    ).toThrow("Invalid Pay state");
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

  test("rejects non-canonical submitted discount codes", () => {
    expect(() =>
      decodeSignedPayState({
        ...buildState(),
        submittedCode: " summer50 ",
      })
    ).toThrow('at ["submittedCode"]');
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
    expect(token).not.toContain(baseReservation.message);
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

  test("builds URL query params", () => {
    const result = runSync(
      sealPayStateForUrl(buildState(), {
        keys: [fixedKey],
        randomBytes: fixedRandomBytes,
      })
    );
    const searchParams = buildPayStateQueryParams(result);

    expect(result.type).toBe("sealedPayState");
    expect(searchParams.get(payStateTokenQueryParam)).toBe(result.token);
  });

  test("builds a clean payable continuation after price review", () => {
    const reviewState = buildState({
      changedKeys: {
        sectionKeys: ["order", "total"],
        itemKeys: ["product:cowork:profi"],
      },
    });
    const path = runSync(
      buildCheckoutPayContinuationPath(reviewState, {
        keys: [fixedKey],
        now: () => fixedNow,
        randomBytes: fixedRandomBytes,
      })
    );
    const token = new URL(path, "https://deskohub.test").searchParams.get(
      payStateTokenQueryParam
    );
    const continued = runSync(
      openPayState(token ?? "", {
        keys: [fixedKey],
        now: () => fixedNow,
      })
    );

    expect(continued.changedKeys).toBeUndefined();
    expect(continued.quote).toEqual(reviewState.quote);
    expect(continued.orderId).toBe(reviewState.orderId);
    expect(continued.submittedCode).toBeUndefined();
    expect(continued.submittedCodeDiscountId).toBeUndefined();
  });
});
