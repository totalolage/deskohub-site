import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposCustomerIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { Effect } from "effect";
import { checkoutStateKeyIdSchema } from "@/features/checkout/backend/checkout/checkout-state-token";
import type { GoodsQuote } from "../goods-quote";
import {
  buildGoodsQuoteState,
  openGoodsQuoteState,
  sealGoodsQuoteState,
} from "./goods-quote-state";

const key = {
  kid: checkoutStateKeyIdSchema.make("quote-test"),
  key: Buffer.alloc(32, 7),
};
const now = new Date("2026-08-16T12:00:00.000Z");
const options = { keys: [key], now: () => now };
const productId = DotyposProductIdSchema.make("product-1");
const legalDocument = (path: string, hashCharacter: string) => ({
  path: `/en-US/${path}`,
  url: `https://workspace.deskohub.cz/en-US/${path}`,
  title: path,
  updatedAt: "2026-01-01",
  hash: hashCharacter.repeat(64),
  hashAlgorithm: "sha256" as const,
});
const quote: GoodsQuote = {
  locale: "en-US",
  cartRevision: 3,
  lines: [
    {
      product: {
        kind: "goods",
        categoryId: DotyposCategoryIdSchema.make("category-1"),
        productId,
      },
      name: "Coffee",
      quantity: 1,
      unitPrice: { value: 5_000, exponent: 2, currency: "CZK" },
      undiscountedSubtotal: { value: 5_000, exponent: 2, currency: "CZK" },
      discounts: [],
      totalDiscount: { value: 0, exponent: 2, currency: "CZK" },
      total: { value: 5_000, exponent: 2, currency: "CZK" },
    },
  ],
  discountIds: [],
  undiscountedTotal: { value: 5_000, exponent: 2, currency: "CZK" },
  totalDiscount: { value: 0, exponent: 2, currency: "CZK" },
  total: { value: 5_000, exponent: 2, currency: "CZK" },
  legalDocuments: {
    termsAndConditions: legalDocument("terms-and-conditions", "a"),
    operatingRules: legalDocument("operating-rules", "b"),
  },
  fingerprint: "fingerprint",
};
const customerId = DotyposCustomerIdSchema.make("customer-1");

describe("goods quote state", () => {
  test("authenticates and decodes the complete customer and cart binding", async () => {
    const state = await Effect.runPromise(
      buildGoodsQuoteState(
        {
          dotyposCustomerId: customerId,
          cart: {
            revision: quote.cartRevision,
            items: [{ productId, quantity: 1 }],
          },
          quote,
        },
        options
      )
    );
    const token = await Effect.runPromise(sealGoodsQuoteState(state, options));
    const opened = await Effect.runPromise(openGoodsQuoteState(token, options));

    expect(opened).toMatchObject({
      dotyposCustomerId: customerId,
      cart: {
        revision: 3,
        items: [{ productId, quantity: 1 }],
      },
      quote: {
        locale: "en-US",
        legalDocuments: quote.legalDocuments,
      },
    });
  });

  test("rejects tampering and expiry", async () => {
    const state = await Effect.runPromise(
      buildGoodsQuoteState(
        {
          dotyposCustomerId: customerId,
          cart: { revision: 3, items: [{ productId, quantity: 1 }] },
          quote,
          ttlMilliseconds: 1_000,
        },
        options
      )
    );
    const token = await Effect.runPromise(sealGoodsQuoteState(state, options));
    const parts = token.split(".");
    const authTag = parts[3]!;
    parts[3] = `${authTag.startsWith("A") ? "B" : "A"}${authTag.slice(1)}`;

    await expect(
      Effect.runPromise(openGoodsQuoteState(parts.join("."), options))
    ).rejects.toMatchObject({ reason: "invalid" });
    await expect(
      Effect.runPromise(
        openGoodsQuoteState(token, {
          ...options,
          now: () => new Date("2026-08-16T12:00:01.000Z"),
        })
      )
    ).rejects.toMatchObject({ reason: "expired" });
  });
});
