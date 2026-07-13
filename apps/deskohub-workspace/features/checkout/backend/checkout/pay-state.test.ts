import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import {
  buildWorkspaceCheckoutQuote,
  toWorkspaceCheckoutOrderInput,
} from "@/features/checkout/checkout-quote";
import type { PayStateKey, SignedPayState } from "./pay-state";

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
      quote: buildWorkspaceCheckoutQuote(
        toWorkspaceCheckoutOrderInput(baseReservation)
      ),
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
    expect(state.reservation).toMatchObject({
      _tag: "cowork",
      tier: "profi",
      startsAt: "2026-06-19T22:00:00Z",
      endsAt: "2026-06-20T22:00:00Z",
    });
    expect(state.reservation).not.toHaveProperty("entryTier");
    expect(state.reservation).not.toHaveProperty("durationMinutes");
    expect(state.quote.order).not.toHaveProperty("startsAt");
    expect(state).not.toHaveProperty("schemaVersion");
    expect(state).not.toHaveProperty("schema");
  });

  test("does not retain interval fields on cowork quote orders", () => {
    const state = buildState();
    const result = signedPayStateSchema.safeParse({
      ...state,
      quote: {
        ...state.quote,
        order: {
          ...state.quote.order,
          startsAt: "2026-06-19T22:00:00Z",
          endsAt: "2026-06-20T22:00:00Z",
        },
      },
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.quote.order).not.toHaveProperty("startsAt");
      expect(result.success.quote.order).not.toHaveProperty("endsAt");
    }
  });

  test("stores meeting room as a reservation tag", () => {
    const reservation = {
      entryTier: "meeting-room" as const,
      startsAt: "2026-06-19T08:00:00Z",
      endsAt: "2026-06-19T12:00:00Z",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 777 777",
    };
    const state = buildSignedPayState(
      {
        locale: "en-US",
        reservation,
        quote: buildWorkspaceCheckoutQuote(
          toWorkspaceCheckoutOrderInput(reservation)
        ),
        orderId: "meeting-room-pay-state-test",
      },
      { keys: [fixedKey], now: () => fixedNow }
    );

    expect(state.reservation).toMatchObject({
      _tag: "meeting-room",
      startsAt: "2026-06-19T08:00:00Z",
      endsAt: "2026-06-19T12:00:00Z",
    });
    expect(state.reservation).not.toHaveProperty("entryTier");
    expect(state.reservation).not.toHaveProperty("tier");
  });

  test("fails closed when no encryption key is configured", () => {
    const previousKeys = process.env.CHECKOUT_PAY_STATE_KEYS;
    delete process.env.CHECKOUT_PAY_STATE_KEYS;

    try {
      expect(() =>
        buildSignedPayState({
          locale: "en-US",
          reservation: baseReservation,
          quote: buildWorkspaceCheckoutQuote(
            toWorkspaceCheckoutOrderInput(baseReservation)
          ),
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

  test("rejects unsupported token header versions", () => {
    const versionTwoToken = replaceTokenHeader(seal(), (header) => ({
      ...header,
      v: 2,
    }));

    expect(() =>
      openPayState(versionTwoToken, { keys: [fixedKey], now: () => fixedNow })
    ).toThrow("Unsupported Pay state token header");
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
});
