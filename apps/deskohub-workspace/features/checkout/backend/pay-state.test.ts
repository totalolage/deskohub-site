import { describe, expect, mock, test } from "bun:test";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import type { PayStateKey, SignedPayState } from "./pay-state";

mock.module("server-only", () => ({}));

const {
  buildPayStateQueryParams,
  buildRetryPayState,
  buildSignedPayState,
  openPayState,
  parsePayStateKey,
  payStateTokenQueryParam,
  sealPayState,
  sealPayStateForUrl,
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
const fixedRandomBytes = (byteLength: number) => Buffer.alloc(byteLength, 7);

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
  const [prefix, encodedHeader, ...rest] = token.split(".");
  if (!prefix || !encodedHeader) throw new Error("Unexpected test token shape");

  const header = parseJsonRecord(
    Buffer.from(encodedHeader, "base64url").toString("utf8")
  );

  return [
    prefix,
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
  const ciphertext = parts[3] ?? "";
  parts[3] = `${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}`;
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

  test("rejects unsupported token and payload versions", () => {
    const versionTwoToken = replaceTokenHeader(seal(), (header) => ({
      ...header,
      v: 2,
    }));

    expect(() =>
      openPayState(versionTwoToken, { keys: [fixedKey], now: () => fixedNow })
    ).toThrow("Unsupported Pay state token header");
    const unsupportedState = parseJsonRecord(
      JSON.stringify({ ...buildState(), schemaVersion: 2 })
    );

    expect(() => sealPayState(unsupportedState)).toThrow(
      "Expected PayStateToken"
    );
  });

  test("does not expose plaintext PII in the encrypted URL token", () => {
    const token = seal();

    expect(token).not.toContain(baseReservation.name);
    expect(token).not.toContain(baseReservation.email);
    expect(token).not.toContain(baseReservation.phone);
    expect(token).not.toContain(baseReservation.message);
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
