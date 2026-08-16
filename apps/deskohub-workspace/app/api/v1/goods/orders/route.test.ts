import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer, Option, Schema } from "effect";
import { CustomerAccountResolver } from "@/features/account";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { goodsOrderSummarySchema } from "@/features/goods";
import {
  GoodsOrderCartChangedError,
  GoodsOrderService,
  GoodsQuoteChangedError,
  GoodsQuoteCustomerMismatchError,
  GoodsQuoteService,
  GoodsQuoteTokenError,
  GoodsQuoteUnavailableError,
} from "@/features/goods/backend";
import type { GoodsQuote } from "@/features/goods/goods-quote";
import { makeGoodsOrdersRoutes } from "./route";

const account = {
  accountId: customerAccountIdSchema.make("account-1"),
  dotyposCustomerId: DotyposCustomerIdSchema.make("customer-1"),
};
const summary = Schema.decodeUnknownSync(goodsOrderSummarySchema)({
  id: "order-1",
  paymentState: "not_started",
  fulfillmentState: "fulfilled",
  fulfilledAt: "2026-08-16T20:00:00.000Z",
  createdAt: "2026-08-16T20:00:00.000Z",
  undiscountedTotal: { value: 9000, exponent: 2, currency: "CZK" },
  payableTotal: { value: 9000, exponent: 2, currency: "CZK" },
});
const quote: GoodsQuote = {
  locale: "en-US",
  cartRevision: 3,
  lines: [
    {
      product: {
        kind: "goods",
        categoryId: "category-1",
        productId: "product-1",
      },
      name: "Sparkling water",
      quantity: 2,
      unitPrice: money(4500),
      undiscountedSubtotal: money(9000),
      discounts: [],
      totalDiscount: money(1000),
      total: money(8000),
    },
  ],
  discountIds: [],
  undiscountedTotal: money(9000),
  totalDiscount: money(1000),
  total: money(8000),
  legalDocuments: {
    termsAndConditions: legalDocument("terms-and-conditions", "a"),
    operatingRules: legalDocument("operating-rules", "b"),
  },
  fingerprint: "fingerprint",
};
const cart = {
  revision: 3,
  items: [{ productId: quote.lines[0]!.product.productId, quantity: 2 }],
};
const commitment = {} as never;
const detail = {
  ...summary,
  payableTotal: money(8000),
  lines: [
    {
      product: quote.lines[0]!.product,
      description: "Sparkling water",
      quantity: 2,
      unitPrice: money(4500),
      undiscountedTotal: money(9000),
      payableTotal: money(8000),
    },
  ],
};

describe("goods orders route", () => {
  test("lists only the authenticated customer's safe order projection", async () => {
    const customers: string[] = [];
    const { GET } = makeGoodsOrdersRoutes(
      Layer.mergeAll(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsOrderService, {
          list: (customerId) => {
            customers.push(customerId);
            return Effect.succeed([summary]);
          },
        }),
        Layer.mock(GoodsQuoteService, {})
      )
    );

    const response = await GET(
      new Request("https://workspace.test/api/v1/goods/orders")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual([summary]);
    expect(customers).toEqual(["customer-1"]);
    expect(JSON.stringify(summary)).not.toContain("customer-1");
  });

  test("issues only acknowledged server-affirmed facts", async () => {
    const quoteCalls: unknown[] = [];
    const orderCalls: unknown[] = [];
    const { POST } = makeGoodsOrdersRoutes(
      Layer.mergeAll(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsQuoteService, {
          openAndAffirm: (customerId, token) => {
            quoteCalls.push([customerId, token]);
            return Effect.succeed({ cart, quote, commitment });
          },
        }),
        Layer.mock(GoodsOrderService, {
          findByIssuanceId: () => Effect.succeed(Option.none()),
          issue: (input) => {
            orderCalls.push(input);
            return Effect.succeed(detail);
          },
        })
      )
    );

    const response = await POST(
      jsonRequest({
        issuanceId: "018f1e36-7a31-7c07-90f4-8f2531cd1212",
        quoteToken: "sealed-token",
        acknowledged: true,
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
    expect(quoteCalls).toEqual([["customer-1", "sealed-token"]]);
    expect(orderCalls).toEqual([
      {
        customerId: "customer-1",
        issuanceId: "018f1e36-7a31-7c07-90f4-8f2531cd1212",
        expectedCart: cart,
        lines: detail.lines,
        locale: "en-US",
        legalDocuments: [
          {
            documentKey: "termsAndConditions",
            document: {
              path: "/en-US/terms-and-conditions",
              hash: "a".repeat(64),
              hashAlgorithm: "sha256",
            },
          },
          {
            documentKey: "operatingRules",
            document: {
              path: "/en-US/operating-rules",
              hash: "b".repeat(64),
              hashAlgorithm: "sha256",
            },
          },
        ],
        discountCommitment: commitment,
      },
    ]);
  });

  test.each([
    undefined,
    false,
  ])("rejects acknowledged=%s before accepting evidence", async (acknowledged) => {
    let quoteCalls = 0;
    let orderCalls = 0;
    const { POST } = makeGoodsOrdersRoutes(
      Layer.mergeAll(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsQuoteService, {
          openAndAffirm: () => {
            quoteCalls += 1;
            return Effect.succeed({ cart, quote, commitment });
          },
        }),
        Layer.mock(GoodsOrderService, {
          findByIssuanceId: () => Effect.succeed(Option.none()),
          issue: () => {
            orderCalls += 1;
            return Effect.succeed(detail);
          },
        })
      )
    );

    const response = await POST(
      jsonRequest({
        issuanceId: "018f1e36-7a31-7c07-90f4-8f2531cd1212",
        quoteToken: "sealed-token",
        ...(acknowledged !== undefined && { acknowledged }),
      })
    );

    expect(response.status).toBe(400);
    expect(quoteCalls).toBe(0);
    expect(orderCalls).toBe(0);
  });

  test("rejects client-authored order facts", async () => {
    let orderCalls = 0;
    const { POST } = makeGoodsOrdersRoutes(
      Layer.mergeAll(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsQuoteService, {}),
        Layer.mock(GoodsOrderService, {
          findByIssuanceId: () => Effect.succeed(Option.none()),
          issue: () => {
            orderCalls += 1;
            return Effect.succeed(detail);
          },
        })
      )
    );

    const response = await POST(
      jsonRequest({
        issuanceId: "018f1e36-7a31-7c07-90f4-8f2531cd1212",
        quoteToken: "sealed-token",
        acknowledged: true,
        lines: detail.lines,
      })
    );

    expect(response.status).toBe(400);
    expect(orderCalls).toBe(0);
  });

  test("returns quote drift without writing an order", async () => {
    let orderCalls = 0;
    const fresh = { quote, quoteToken: "fresh-token" };
    const { POST } = makeGoodsOrdersRoutes(
      Layer.mergeAll(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsQuoteService, {
          openAndAffirm: () =>
            Effect.fail(new GoodsQuoteChangedError({ fresh })),
        }),
        Layer.mock(GoodsOrderService, {
          findByIssuanceId: () => Effect.succeed(Option.none()),
          issue: () => {
            orderCalls += 1;
            return Effect.succeed(detail);
          },
        })
      )
    );

    const response = await POST(validRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "quote_changed",
      quote: fresh,
    });
    expect(orderCalls).toBe(0);
  });

  test("hides a quote owned by another customer", async () => {
    let orderCalls = 0;
    const { POST } = makeGoodsOrdersRoutes(
      Layer.mergeAll(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsQuoteService, {
          openAndAffirm: () =>
            Effect.fail(new GoodsQuoteCustomerMismatchError()),
        }),
        Layer.mock(GoodsOrderService, {
          findByIssuanceId: () => Effect.succeed(Option.none()),
          issue: () => {
            orderCalls += 1;
            return Effect.succeed(detail);
          },
        })
      )
    );

    const response = await POST(validRequest());

    expect(response.status).toBe(404);
    expect(orderCalls).toBe(0);
  });

  test("replays an issued order without reopening a stale quote", async () => {
    let quoteCalls = 0;
    let issueCalls = 0;
    const { POST } = makeGoodsOrdersRoutes(
      Layer.mergeAll(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsQuoteService, {
          openAndAffirm: () => {
            quoteCalls += 1;
            return Effect.succeed({ cart, quote, commitment });
          },
        }),
        Layer.mock(GoodsOrderService, {
          findByIssuanceId: () => Effect.succeed(Option.some(detail)),
          issue: () => {
            issueCalls += 1;
            return Effect.succeed(detail);
          },
        })
      )
    );

    const response = await POST(validRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
    expect(quoteCalls).toBe(0);
    expect(issueCalls).toBe(0);
  });

  test.each([
    ["invalid", 400],
    ["expired", 409],
    ["configuration", 503],
  ] as const)("maps %s quote tokens to HTTP %d", async (reason, status) => {
    const { POST } = makeGoodsOrdersRoutes(
      Layer.mergeAll(
        Layer.mock(CustomerAccountResolver, {
          resolve: () => Effect.succeed(account),
        }),
        Layer.mock(GoodsQuoteService, {
          openAndAffirm: () =>
            Effect.fail(
              new GoodsQuoteTokenError({ reason, cause: new Error("token") })
            ),
        }),
        Layer.mock(GoodsOrderService, {
          findByIssuanceId: () => Effect.succeed(Option.none()),
        })
      )
    );

    expect((await POST(validRequest())).status).toBe(status);
  });

  test("returns typed cart drift and dependency failures", async () => {
    const route = (
      quoteResult:
        | ReturnType<
            typeof Effect.succeed<{
              cart: typeof cart;
              quote: GoodsQuote;
              commitment: never;
            }>
          >
        | ReturnType<typeof Effect.fail<GoodsQuoteUnavailableError>>,
      issueResult:
        | ReturnType<typeof Effect.succeed<typeof detail>>
        | ReturnType<typeof Effect.fail<GoodsOrderCartChangedError>>
    ) =>
      makeGoodsOrdersRoutes(
        Layer.mergeAll(
          Layer.mock(CustomerAccountResolver, {
            resolve: () => Effect.succeed(account),
          }),
          Layer.mock(GoodsQuoteService, {
            openAndAffirm: () => quoteResult,
          }),
          Layer.mock(GoodsOrderService, {
            findByIssuanceId: () => Effect.succeed(Option.none()),
            issue: () => issueResult,
          })
        )
      ).POST;
    const unavailable = route(
      Effect.fail(
        new GoodsQuoteUnavailableError({ reason: "dependency_unavailable" })
      ),
      Effect.succeed(detail)
    );
    const drifted = route(
      Effect.succeed({ cart, quote, commitment }),
      Effect.fail(new GoodsOrderCartChangedError({ current: cart }))
    );

    expect((await unavailable(validRequest())).status).toBe(503);
    const driftResponse = await drifted(validRequest());
    expect(driftResponse.status).toBe(409);
    expect(await driftResponse.json()).toEqual({
      error: "cart_changed",
      cart,
    });
  });
});

function money(value: number) {
  return { value, exponent: 2 as const, currency: "CZK" as const };
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

const validRequest = () =>
  jsonRequest({
    issuanceId: "018f1e36-7a31-7c07-90f4-8f2531cd1212",
    quoteToken: "sealed-token",
    acknowledged: true,
  });

type TestIssueRequest = {
  readonly issuanceId: string;
  readonly quoteToken: string;
  readonly acknowledged?: boolean;
  readonly lines?: typeof detail.lines;
};

const jsonRequest = (body: TestIssueRequest) =>
  new Request("https://workspace.test/api/v1/goods/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
