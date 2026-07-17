import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { Schema } from "effect";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import { canonicalDiscountCodeSchema } from "@/features/discounts/contracts";
import type { PayStateKey, SignedPayState } from "./pay-state";

mock.module("server-only", () => ({}));

const {
  buildPayStateQueryParams,
  buildRetryPayState,
  buildSignedPayState,
  openPayState,
  parsePayStateKey,
  payStateTokenQueryParam,
  retryPayStateSchema,
  sealPayState,
  sealPayStateForUrl,
  signedPayStateSchema,
} = await import("./pay-state");

const fixedNow = new Date("2026-06-01T10:00:00.000Z");
const fixedKey: PayStateKey = parsePayStateKey(
  "test-kid",
  Buffer.alloc(32, 1).toString("base64url")
);
const wrongKey: PayStateKey = parsePayStateKey(
  "test-kid",
  Buffer.alloc(32, 2).toString("base64url")
);
const rotatedKey: PayStateKey = parsePayStateKey(
  "rotated-kid",
  Buffer.alloc(32, 3).toString("base64url")
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
const decodeRetryPayState = Schema.decodeUnknownSync(
  retryPayStateSchema,
  strictParseOptions
);

const baseReservation = {
  entryTier: "profi" as const,
  date: "2026-06-20",
  coffee: true,
  monitorOption: "2x27-qhd" as const,
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
  message: "Private setup note.",
};

const buildState = (overrides: Partial<SignedPayState> = {}) => ({
  ...buildSignedPayState(
    {
      locale: "en-US",
      reservation: baseReservation,
      quote: buildWorkspaceCheckoutQuote(baseReservation),
      orderId: "pay-state-test-order-id",
      submittedCode: canonicalCode,
      ttlMilliseconds: 10 * 60 * 1000,
    },
    { keys: [fixedKey], now: () => fixedNow }
  ),
  ...overrides,
});

const seal = (state = buildState()) =>
  sealPayState(state, { keys: [fixedKey], randomBytes: fixedRandomBytes });

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
      openPayState(token, { keys: [fixedKey], now: () => fixedNow })
    ).toEqual(state);
    expect(state.orderId).toBe("pay-state-test-order-id");
    expect(state.submittedCode).toBe(canonicalCode);
    expect(token.split(".")).toHaveLength(4);
  });

  test("preserves required-coffee normalization in signed Pay state", () => {
    const state = buildSignedPayState(
      {
        locale: "en-US",
        reservation: { ...baseReservation, coffee: false },
        quote: buildWorkspaceCheckoutQuote(baseReservation),
        orderId: "required-coffee-order-id",
      },
      { keys: [fixedKey], now: () => fixedNow }
    );

    expect(state.reservation.coffee).toBe(true);
  });

  test("fails closed when no encryption key is configured", () => {
    const previousKeys = process.env.CHECKOUT_PAY_STATE_KEYS;
    delete process.env.CHECKOUT_PAY_STATE_KEYS;

    try {
      expect(() =>
        buildSignedPayState({
          locale: "en-US",
          reservation: baseReservation,
          quote: buildWorkspaceCheckoutQuote(baseReservation),
          orderId: "missing-key-test",
        })
      ).toThrow("CHECKOUT_PAY_STATE_KEYS");
    } finally {
      if (previousKeys === undefined) {
        delete process.env.CHECKOUT_PAY_STATE_KEYS;
      } else {
        process.env.CHECKOUT_PAY_STATE_KEYS = previousKeys;
      }
    }
  });

  test("rejects expired tokens", () => {
    const token = seal(buildState());

    expect(() =>
      openPayState(token, {
        keys: [fixedKey],
        now: () => new Date("2026-06-01T10:11:00.000Z"),
      })
    ).toThrow("expired");
  });

  test("rejects tampered ciphertext", () => {
    expect(() =>
      openPayState(tamperCiphertext(seal()), {
        keys: [fixedKey],
        now: () => fixedNow,
      })
    ).toThrow("Invalid Pay state token");
  });

  test("rejects wrong and unknown key ids", () => {
    const token = seal();
    const unknownKidToken = replaceTokenHeader(token, (header) => ({
      ...header,
      kid: "unknown-kid",
    }));

    expect(() =>
      openPayState(token, { keys: [wrongKey], now: () => fixedNow })
    ).toThrow("Invalid Pay state token");
    expect(() =>
      openPayState(unknownKidToken, { keys: [fixedKey], now: () => fixedNow })
    ).toThrow("unknown key id");
  });

  test("keeps existing tokens readable while rotating to a new active key", () => {
    const oldState = buildState();
    const oldToken = seal(oldState);
    const newState = buildSignedPayState(
      {
        locale: "en-US",
        reservation: baseReservation,
        quote: buildWorkspaceCheckoutQuote(baseReservation),
        orderId: "rotated-key-order-id",
      },
      { keys: [rotatedKey, fixedKey], now: () => fixedNow }
    );

    expect(
      openPayState(oldToken, {
        keys: [rotatedKey, fixedKey],
        now: () => fixedNow,
      })
    ).toEqual(oldState);
    expect(newState.kid).toBe(rotatedKey.kid);
    expect(
      openPayState(
        sealPayState(newState, {
          keys: [rotatedKey, fixedKey],
          randomBytes: fixedRandomBytes,
        }),
        { keys: [rotatedKey, fixedKey], now: () => fixedNow }
      )
    ).toEqual(newState);
  });

  test("rejects old prefixed and versioned token headers", () => {
    expect(() =>
      openPayState(`dhp1.${seal()}`, {
        keys: [fixedKey],
        now: () => fixedNow,
      })
    ).toThrow("Invalid Pay state token");

    const versionedToken = replaceTokenHeader(seal(), (header) => ({
      ...header,
      v: 1,
      alg: "A256GCM",
    }));

    expect(() =>
      openPayState(versionedToken, {
        keys: [fixedKey],
        now: () => fixedNow,
      })
    ).toThrow("Invalid Pay state token header");
  });

  test("rejects old versioned signed, quote, summary, and retry shapes", () => {
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
    const oldRetryState = {
      ...buildRetryPayState({
        paymentOrderId: "payment-order-id",
        checkoutToken: "A".repeat(43),
      }),
      schemaVersion: 1,
    };

    expect(() => decodeSignedPayState(oldSignedState)).toThrow();
    expect(() => decodeRetryPayState(oldRetryState)).toThrow();
    expect(() =>
      sealPayState(oldSignedState as unknown as SignedPayState, {
        keys: [fixedKey],
      })
    ).toThrow('at ["schemaVersion"]');
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
    const result = sealPayStateForUrl(buildState(), {
      keys: [fixedKey],
      randomBytes: fixedRandomBytes,
    });
    const searchParams = buildPayStateQueryParams(result);

    expect(result.type).toBe("sealedPayState");
    expect(searchParams.get(payStateTokenQueryParam)).toBe(result.token);
  });

  test("models retry state as CheckoutReturnStateTokenRepository semantics", () => {
    expect(
      buildRetryPayState({
        paymentOrderId: "payment-order-id",
        checkoutToken: "A".repeat(43),
      })
    ).toMatchObject({
      type: "retryPayState",
      stateSemantics: "checkout-return-state-token",
      repositorySemantics: {
        repository: "CheckoutReturnStateTokenRepository",
        opaque: true,
        singleUse: true,
        boundToPaymentOrderId: true,
      },
    });
  });
});
