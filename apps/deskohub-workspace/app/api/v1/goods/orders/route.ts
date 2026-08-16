import { Effect, Layer, Option } from "effect";
import { NextResponse } from "next/server";
import { CustomerAccountResolver } from "@/features/account";
import { type GoodsCart, issueGoodsOrderRequestSchema } from "@/features/goods";
import {
  GoodsOrderService,
  GoodsQuoteService,
  type GoodsQuoteUnavailableError,
} from "@/features/goods/backend";
import {
  decodeGoodsRequest,
  resolveGoodsCustomerId,
} from "@/features/goods/backend/goods-route";
import type {
  GoodsQuote,
  GoodsQuoteResponse,
} from "@/features/goods/goods-quote";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

type GoodsOrdersRouteLayer = Layer.Layer<
  CustomerAccountResolver | GoodsOrderService | GoodsQuoteService,
  unknown,
  never
>;

export const makeGoodsOrdersRoutes = (layer: GoodsOrdersRouteLayer) => ({
  GET: defineWorkspaceRoute(
    {
      operation: "goods.orders.list",
      cancellation: "interrupt-on-disconnect",
    },
    () =>
      Effect.gen(function* () {
        const customerId = yield* resolveGoodsCustomerId();
        const orders = yield* GoodsOrderService;
        const result = yield* orders.list(customerId);
        return NextResponse.json(result, {
          headers: { "Cache-Control": "private, no-store" },
        });
      }).pipe(
        Effect.provide(layer),
        Effect.mapError((cause) =>
          cause instanceof WorkspaceRouteFailure
            ? cause
            : WorkspaceRouteFailure.internal(
                "Goods orders are temporarily unavailable."
              )(cause)
        )
      )
  ),
  POST: defineWorkspaceRoute(
    {
      operation: "goods.orders.issue",
      cancellation: "continue-after-disconnect",
    },
    (request) =>
      Effect.gen(function* () {
        const input = yield* decodeGoodsRequest(
          request,
          issueGoodsOrderRequestSchema,
          "Order acknowledgement is invalid."
        );
        const customerId = yield* resolveGoodsCustomerId();
        const orders = yield* GoodsOrderService;
        const existing = yield* orders.findByIssuanceId(
          customerId,
          input.issuanceId
        );
        if (Option.isSome(existing)) return orderResponse(existing.value);
        const quotes = yield* GoodsQuoteService;
        const affirmed = yield* quotes.openAndAffirm(
          customerId,
          input.quoteToken
        );
        const [firstLine, ...remainingLines] = affirmed.quote.lines;
        if (!firstLine) {
          return yield* Effect.die("Affirmed goods quote has no lines.");
        }
        const order = yield* orders.issue({
          customerId,
          issuanceId: input.issuanceId,
          expectedCart: affirmed.cart,
          lines: [
            toGoodsOrderLine(firstLine),
            ...remainingLines.map(toGoodsOrderLine),
          ],
          locale: affirmed.quote.locale,
          legalDocuments: [
            {
              documentKey: "termsAndConditions",
              document: {
                path: affirmed.quote.legalDocuments.termsAndConditions.path,
                hash: affirmed.quote.legalDocuments.termsAndConditions.hash,
                hashAlgorithm:
                  affirmed.quote.legalDocuments.termsAndConditions
                    .hashAlgorithm,
              },
            },
            {
              documentKey: "operatingRules",
              document: {
                path: affirmed.quote.legalDocuments.operatingRules.path,
                hash: affirmed.quote.legalDocuments.operatingRules.hash,
                hashAlgorithm:
                  affirmed.quote.legalDocuments.operatingRules.hashAlgorithm,
              },
            },
          ],
          discountCommitment: affirmed.commitment,
        });
        return orderResponse(order);
      }).pipe(
        Effect.catchTags({
          GoodsQuoteChangedError: ({ fresh }) =>
            conflictResponse({ error: "quote_changed", quote: fresh }),
          GoodsQuoteCustomerMismatchError: (cause) =>
            Effect.fail(
              new WorkspaceRouteFailure({
                statusCode: 404,
                publicMessage: "Goods quote was not found.",
                cause,
              })
            ),
          GoodsQuoteTokenError: quoteTokenFailure,
          GoodsQuoteUnavailableError: quoteUnavailableResponse,
          GoodsOrderCartChangedError: ({ current }) =>
            conflictResponse({ error: "cart_changed", cart: current }),
          GoodsOrderIssuanceConflictError: () =>
            conflictResponse({ error: "issuance_conflict" }),
          DiscountClaimError: () =>
            conflictResponse({ error: "discount_unavailable" }),
          GoodsOrderUnavailableError: (cause) =>
            Effect.fail(
              new WorkspaceRouteFailure({
                statusCode: 503,
                publicMessage: "Goods orders are temporarily unavailable.",
                cause,
              })
            ),
        }),
        Effect.provide(layer),
        Effect.mapError((cause) =>
          cause instanceof WorkspaceRouteFailure
            ? cause
            : WorkspaceRouteFailure.internal(
                "Goods order could not be issued."
              )(cause)
        )
      )
  ),
});

const orderResponse = (order: Parameters<typeof NextResponse.json>[0]) =>
  NextResponse.json(order, {
    headers: { "Cache-Control": "private, no-store" },
  });

const toGoodsOrderLine = (line: GoodsQuote["lines"][number]) => ({
  product: line.product,
  description: line.name,
  quantity: line.quantity,
  unitPrice: line.unitPrice,
  undiscountedTotal: line.undiscountedSubtotal,
  payableTotal: line.total,
});

const conflictResponse = (body: {
  readonly error: string;
  readonly quote?: GoodsQuoteResponse;
  readonly cart?: GoodsCart;
}) =>
  Effect.succeed(
    NextResponse.json(body, {
      status: 409,
      headers: { "Cache-Control": "private, no-store" },
    })
  );

const quoteTokenFailure = (cause: {
  readonly reason: "configuration" | "expired" | "invalid";
}) => {
  if (cause.reason === "configuration") {
    return Effect.fail(
      new WorkspaceRouteFailure({
        statusCode: 503,
        publicMessage: "Goods orders are temporarily unavailable.",
        cause,
      })
    );
  }
  if (cause.reason === "expired") {
    return Effect.fail(
      new WorkspaceRouteFailure({
        statusCode: 409,
        publicMessage: "Goods quote has expired.",
        cause,
      })
    );
  }
  return Effect.fail(
    new WorkspaceRouteFailure({
      statusCode: 400,
      publicMessage: "Goods quote is invalid.",
      cause,
    })
  );
};

const quoteUnavailableResponse = (error: GoodsQuoteUnavailableError) => {
  if (error.reason === "dependency_unavailable") {
    return Effect.fail(
      new WorkspaceRouteFailure({
        statusCode: 503,
        publicMessage: "Goods quote is temporarily unavailable.",
        cause: error,
      })
    );
  }
  return Effect.succeed(
    NextResponse.json(
      {
        error: error.reason,
        ...(error.productIds && { productIds: error.productIds }),
      },
      {
        status: error.reason === "empty_cart" ? 400 : 409,
        headers: { "Cache-Control": "private, no-store" },
      }
    )
  );
};

const goodsOrdersRouteLayer = Layer.mergeAll(
  CustomerAccountResolver.Live,
  GoodsOrderService.Live,
  GoodsQuoteService.Live
);

export const { GET, POST } = makeGoodsOrdersRoutes(goodsOrdersRouteLayer);
