import { describe, expect, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposCustomerIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { CustomerAccountResolver } from "@/features/account";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import {
  GoodsQuoteService,
  GoodsQuoteUnavailableError,
} from "@/features/goods/backend";
import type { GoodsQuote } from "@/features/goods/goods-quote";
import { makeGoodsQuoteRoute } from "./route";

const account = {
  accountId: Schema.decodeUnknownSync(customerAccountIdSchema)("account-id"),
  dotyposCustomerId: DotyposCustomerIdSchema.make("customer-id"),
};
const quote: GoodsQuote = {
  locale: "en-US",
  cartRevision: 1,
  lines: [
    {
      product: {
        kind: "goods",
        categoryId: DotyposCategoryIdSchema.make("category-id"),
        productId: DotyposProductIdSchema.make("product-id"),
      },
      name: "Coffee",
      quantity: 1,
      unitPrice: money(5_000),
      undiscountedSubtotal: money(5_000),
      discounts: [],
      totalDiscount: money(0),
      total: money(5_000),
    },
  ],
  discountIds: [],
  undiscountedTotal: money(5_000),
  totalDiscount: money(0),
  total: money(5_000),
  legalDocuments: {
    termsAndConditions: legalDocument("terms-and-conditions", "a"),
    operatingRules: legalDocument("operating-rules", "b"),
  },
  fingerprint: "fingerprint",
};

describe("goods quote route", () => {
  test("resolves the customer and passes only strict quote input", async () => {
    const calls: unknown[] = [];
    const POST = makeGoodsQuoteRoute(
      Layer.merge(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsQuoteService, {
          quote: (customerId, input) => {
            calls.push([customerId, input]);
            return Effect.succeed({ quote, quoteToken: "sealed-token" });
          },
        })
      )
    );

    const response = await POST(
      jsonRequest({ locale: "en-US", submittedCode: "LUNCH10" })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toEqual([
      ["customer-id", { locale: "en-US", submittedCode: "LUNCH10" }],
    ]);
  });

  test("rejects invalid input before quote resolution", async () => {
    let quoteCalls = 0;
    const POST = makeGoodsQuoteRoute(
      Layer.merge(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsQuoteService, {
          quote: () => {
            quoteCalls += 1;
            return Effect.succeed({ quote, quoteToken: "sealed-token" });
          },
        })
      )
    );

    const response = await POST(jsonRequest({ locale: "de-DE" }));

    expect(response.status).toBe(400);
    expect(quoteCalls).toBe(0);
  });

  test("returns safe cart-state errors", async () => {
    const POST = makeGoodsQuoteRoute(
      Layer.merge(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsQuoteService, {
          quote: () =>
            Effect.fail(
              new GoodsQuoteUnavailableError({ reason: "empty_cart" })
            ),
        })
      )
    );

    const response = await POST(jsonRequest({ locale: "en-US" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "empty_cart" });
  });
});

function money(value: number) {
  return { value, exponent: 2, currency: "CZK" };
}

function legalDocument(path: string, hashCharacter: string) {
  return {
    path: `/en-US/${path}`,
    url: `https://workspace.deskohub.cz/en-US/${path}`,
    title: path,
    updatedAt: "2026-01-01",
    hash: hashCharacter.repeat(64),
    hashAlgorithm: "sha256" as const,
  };
}

const jsonRequest = (body: {
  readonly locale: string;
  readonly submittedCode?: string;
}) =>
  new Request("https://workspace.test/api/v1/goods/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
