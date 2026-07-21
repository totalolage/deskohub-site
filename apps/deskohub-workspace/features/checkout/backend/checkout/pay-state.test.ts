import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { Effect, Schema } from "effect";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote.test-utils";
import { canonicalDiscountCodeSchema } from "@/features/discounts/contracts";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import type { PayStateKey, SignedPayState } from "./pay-state";

mock.module("server-only", () => ({}));

const {
  buildPayStateQueryParams,
  buildSignedPayState,
  openPayState,
  parsePayStateKey,
  payStateTokenQueryParam,
  sealPayState,
  sealPayStateForUrl,
  signedPayStateSchema,
} = await import("./pay-state");
const { buildFreshCheckoutPayPath } = await import("./checkout-pay-url");

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
        quote: buildWorkspaceCheckoutQuote(baseReservation),
        orderId: "pay-state-test-order-id",
        submittedCode: canonicalCode,
        ttlMilliseconds: 10 * 60 * 1000,
      },
      { keys: [fixedKey], now: () => fixedNow }
    )
  ),
  ...overrides,
});

const seal = (state = buildState()) =>
  runSync(
    sealPayState(state, { keys: [fixedKey], randomBytes: fixedRandomBytes })
  );

const replaceTokenHeader = (
  token: string,
  replace: (header: Record<string, unknown>) => Record<string, unknown>
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

const parseJsonRecord = (json: string): Record<string, unknown> => {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, value])
  );
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

    expect(
      runSync(openPayState(token, { keys: [fixedKey], now: () => fixedNow }))
    ).toEqual(state);
    expect(state.orderId).toBe("pay-state-test-order-id");
    expect(state.submittedCode).toBe(canonicalCode);
    expect(token.split(".")).toHaveLength(4);
  });

  test("omits redundant payload markers from signed Pay state", () => {
    const state = buildState();

    expect(state).not.toHaveProperty("type");
    expect(state).not.toHaveProperty("schema");
  });

  test("preserves required-coffee normalization in signed Pay state", () => {
    const state = runSync(
      buildSignedPayState(
        {
          locale: "en-US",
          reservation: { ...baseReservation, coffee: false } as never,
          quote: buildWorkspaceCheckoutQuote(baseReservation),
          orderId: "required-coffee-order-id",
        },
        { keys: [fixedKey], now: () => fixedNow }
      )
    );

    expect(state.reservation.coffee).toBe(true);
  });

  test("fails closed when no encryption key is configured", () => {
    expect(() =>
      runSync(
        buildSignedPayState(
          {
            locale: "en-US",
            reservation: baseReservation,
            quote: buildWorkspaceCheckoutQuote(baseReservation),
            orderId: "missing-key-test",
          },
          { keys: [] }
        )
      )
    ).toThrow("At least one");
  });

  test("rejects expired tokens", () => {
    const token = seal(buildState());

    expect(() =>
      runSync(
        openPayState(token, {
          keys: [fixedKey],
          now: () => new Date("2026-06-01T10:11:00.000Z"),
        })
      )
    ).toThrow("expired");
  });

  test("rejects tampered ciphertext", () => {
    expect(() =>
      runSync(
        openPayState(tamperCiphertext(seal()), {
          keys: [fixedKey],
          now: () => fixedNow,
        })
      )
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
          quote: buildWorkspaceCheckoutQuote(baseReservation),
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
        summary: { ...state.quote.summary, schemaVersion: 1 },
      },
    };
    expect(() => decodeSignedPayState(oldSignedState)).toThrow();
    expect(() =>
      runSync(
        sealPayState(oldSignedState as unknown as SignedPayState, {
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

  test("does not expose plaintext PII in the encrypted URL token", () => {
    const token = seal();

    expect(token).not.toContain(baseReservation.name);
    expect(token).not.toContain(baseReservation.email);
    expect(token).not.toContain(baseReservation.phone);
    expect(token).not.toContain(baseReservation.message);
    expect(token).not.toContain("SUMMER50");
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
        itemKeys: ["order/product:cowork:profi"],
      },
    });
    const path = runSync(
      buildFreshCheckoutPayPath(
        {
          locale: reviewState.locale,
          reservation: reviewState.reservation,
          quote: reviewState.quote,
          orderId: reviewState.orderId,
          submittedCode: reviewState.submittedCode,
        },
        {
          keys: [fixedKey],
          now: () => fixedNow,
          randomBytes: fixedRandomBytes,
        }
      )
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
    expect(continued.submittedCode).toBe(reviewState.submittedCode);
  });
});
