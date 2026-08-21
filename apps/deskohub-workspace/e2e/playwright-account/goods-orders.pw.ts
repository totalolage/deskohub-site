import "../../shared/polyfills/temporal";

import type { Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import {
  accountingDocumentSnapshots,
  discountApplications,
  discountCodeRedemptions,
  goodsCartItems,
  goodsCarts,
  invoiceEmailDeliveries,
  invoices,
  legalEvidenceEvents,
  orderLines,
  orders,
  paymentAttempts,
} from "@/db/schema";
import {
  goodsCartSchema,
  goodsCatalogSchema,
  goodsOrderDetailSchema,
  goodsOrderSummarySchema,
} from "@/features/goods";
import type { GoodsOrderDetail } from "@/features/goods/goods-order";
import { goodsQuoteResponseSchema } from "@/features/goods/goods-quote";
import { openBrowserPage } from "../browser";
import { completeNexiHostedPayment } from "../checkout/payment";
import { getConfig, getDatasourceConfig } from "../config";
import { toWorkspaceE2EError, tryWorkspaceE2ESync } from "../errors";
import { enablePreviewAccess } from "../instant-navigation/navigation-test-helpers";
import { waitForCheckoutRow } from "../integrations/database";
import { E2EDatabase } from "../integrations/database.service";
import { runRetrySafeDatabaseOperation } from "../integrations/database-operation";
import { discountCodeFixtures } from "../integrations/discount-fixtures";
import { useNeonAuthMagicLinkCapture } from "../integrations/neon-auth";
import { test } from "../playwright-checkout/fixtures";
import { readWorkspaceE2ECaseJournals } from "../playwright-checkout/run-plan";
import { pollUntil } from "../polling";
import { assert } from "../runtime";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import {
  browserStep,
  deleteCustomerAccountLinks,
  requestMagicLink,
  requireSession,
  waitForCustomerAccountLink,
} from "./account-auth";

type ApiResponse = {
  readonly body: unknown;
  readonly status: number;
};

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

test("authenticated goods order lifecycle", async ({
  browserRunner,
  environment,
  page,
  runEffect,
}) => {
  const config = getConfig(environment);
  test.setTimeout(config.timeouts.accountCase);
  const datasourceConfig = getDatasourceConfig(environment);
  const neonAuth = datasourceConfig.neonAuth;
  assert(neonAuth, "Neon Auth configuration is required for goods order E2E");

  const [state] = await readWorkspaceE2ECaseJournals([
    "checkout-meeting-room-paid-one-hour",
  ]);
  assert(state?.orderId, "goods E2E checkout order is missing");
  const checkoutRow = await runEffect(
    waitForCheckoutRow(datasourceConfig, state.orderId)
  );
  const customerId = checkoutRow.dotypos_customer_id;
  assert(customerId, "goods E2E Dotypos customer is missing");

  await runEffect(
    Effect.acquireUseRelease(
      Effect.sync(() => new Set<string>()),
      (accountIds) =>
        useNeonAuthMagicLinkCapture(neonAuth, state.data.email, (capture) =>
          Effect.gen(function* () {
            yield* requestMagicLink({
              callbackPath: "/en-US/account",
              capture,
              config,
              email: state.data.email,
              page,
              validateInvalidEmail: false,
            });
            const session = yield* requireSession(page, state.data.email);
            capture.rememberUserId(session.user.id);
            accountIds.add(session.user.id);
            yield* waitForCustomerAccountLink(
              session.user.id,
              customerId,
              true
            );

            const catalogResponse = yield* requestJson(page, {
              method: "GET",
              path: "/api/v1/goods/catalog?locale=en-US",
            });
            const catalog = yield* decodeResponse(
              "goods catalog",
              catalogResponse,
              goodsCatalogSchema
            );
            const product = catalog.categories
              .flatMap((category) => category.products)
              .find(({ unitPrice }) => unitPrice.value > 0);
            assert(product, "goods E2E catalog has no payable product");

            let cart = yield* readCart(page);
            for (const item of cart.items) {
              const response = yield* requestJson(page, {
                method: "DELETE",
                path: "/api/v1/goods/cart",
                body: {
                  expectedRevision: cart.revision,
                  productId: item.productId,
                },
              });
              cart = yield* decodeResponse(
                "clear goods cart item",
                response,
                goodsCartSchema
              );
            }

            cart = yield* setCartItem(page, {
              expectedRevision: cart.revision,
              productId: product.identity.productId,
              quantity: 1,
            });
            const discountedQuote = yield* quoteCart(
              page,
              discountCodeFixtures.partial.code
            );
            yield* tryWorkspaceE2ESync("assert discounted goods quote", () => {
              assert(
                discountedQuote.quote.discountIds.length > 0,
                "goods discount was not applied"
              );
              assert(
                discountedQuote.quote.total.value <
                  discountedQuote.quote.undiscountedTotal.value,
                "goods discounted total did not decrease"
              );
            });
            const firstOrder = yield* issueOrder(
              page,
              discountedQuote.quoteToken
            );
            yield* assertSafeOrderDetail(firstOrder);
            yield* assertIssuedGoodsEvidence(firstOrder.id, true);

            const clearedCart = yield* readCart(page);
            yield* tryWorkspaceE2ESync("assert issued cart cleared", () => {
              assert(
                clearedCart.items.length === 0,
                "issued cart is not empty"
              );
              assert(
                clearedCart.revision > cart.revision,
                "issued cart revision did not advance"
              );
            });

            yield* setCartItem(page, {
              expectedRevision: clearedCart.revision,
              productId: product.identity.productId,
              quantity: 1,
            });
            const secondQuote = yield* quoteCart(page);
            const secondOrder = yield* issueOrder(page, secondQuote.quoteToken);

            const historyResponse = yield* requestJson(page, {
              method: "GET",
              path: "/api/v1/goods/orders",
            });
            const history = yield* decodeResponse(
              "goods order history",
              historyResponse,
              Schema.Array(goodsOrderSummarySchema)
            );
            yield* tryWorkspaceE2ESync("assert safe goods history", () => {
              assert(
                history.some(({ id }) => id === firstOrder.id) &&
                  history.some(({ id }) => id === secondOrder.id),
                "issued goods orders are missing from history"
              );
              for (const summary of history) assertSafeProjection(summary);
            });

            const blockedPayment = yield* startPayment(page, secondOrder.id);
            yield* tryWorkspaceE2ESync("assert oldest debt admission", () => {
              assert(
                blockedPayment.status === "outstanding_order" &&
                  blockedPayment.orderId === firstOrder.id,
                "newer goods payment did not identify the oldest unpaid order"
              );
            });

            const payment = yield* startPayment(page, firstOrder.id);
            const redirectUrl = yield* requirePaymentRedirect(payment);
            const resumed = yield* startPayment(page, firstOrder.id);
            yield* tryWorkspaceE2ESync("assert goods payment resume", () => {
              assert(
                resumed.status === "redirect" ||
                  resumed.status === "in_progress",
                "goods payment did not resume the active attempt"
              );
              if (resumed.status === "redirect") {
                assert(
                  resumed.redirectUrl === redirectUrl,
                  "goods payment resume changed the hosted session"
                );
              }
            });
            yield* assertGoodsPaymentSnapshot(firstOrder.id);

            const providerSession = `workspace-goods-e2e-${crypto.randomUUID()}`;
            yield* openBrowserPage(
              config,
              browserRunner,
              providerSession,
              redirectUrl,
              { timeoutMs: config.timeouts.providerTransition }
            );
            yield* completeNexiHostedPayment({
              data: state.data,
              run: browserRunner,
              session: providerSession,
              timeouts: config.timeouts,
            });

            const paidOrder = yield* pollUntil(
              requestJson(page, {
                method: "GET",
                path: `/api/v1/goods/orders/${encodeURIComponent(firstOrder.id)}?paymentOutcome=completed`,
              }).pipe(
                Effect.flatMap((response) =>
                  response.status === 200
                    ? decodeResponse(
                        "reconciled goods order detail",
                        response,
                        goodsOrderDetailSchema
                      )
                    : Effect.succeed(undefined)
                ),
                Effect.map((detail) =>
                  detail?.paymentState === "paid" ? detail : undefined
                )
              ),
              {
                intervalMs: workspaceE2EPollIntervalMs.datasource,
                label: "paid goods order after provider return",
                timeoutMs: config.timeouts.providerTransition,
              }
            );
            yield* assertSafeOrderDetail(paidOrder);
            yield* assertPaidGoodsAccounting(firstOrder.id);

            const admittedPayment = yield* startPayment(page, secondOrder.id);
            yield* requirePaymentRedirect(admittedPayment);
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                "run authenticated goods order lifecycle",
                cause
              )
            )
          )
        ),
      (accountIds) =>
        deleteCustomerAccountLinks(accountIds).pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("clean up goods E2E account links", cause)
          )
        )
    )
  );
});

const requestJson = (
  page: Page,
  input: {
    readonly body?: unknown;
    readonly method: "DELETE" | "GET" | "POST" | "PUT";
    readonly path: string;
  }
) =>
  browserStep(`request ${input.method} ${input.path.split("?")[0]}`, () =>
    page.evaluate(async ({ body, method, path }) => {
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers:
          body === undefined
            ? undefined
            : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return {
        body: text ? (JSON.parse(text) as unknown) : undefined,
        status: response.status,
      };
    }, input)
  );

const decodeResponse = <A, I>(
  operation: string,
  response: ApiResponse,
  schema: Schema.Codec<A, I, never>
) =>
  Effect.gen(function* () {
    yield* tryWorkspaceE2ESync(`assert ${operation} response`, () => {
      assert(
        response.status === 200,
        `${operation} returned ${response.status}`
      );
    });
    return yield* Schema.decodeUnknownEffect(schema)(response.body).pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError(`decode ${operation}`, cause)
      )
    );
  });

const readCart = (page: Page) =>
  Effect.flatMap(
    requestJson(page, { method: "GET", path: "/api/v1/goods/cart" }),
    (response) => decodeResponse("goods cart", response, goodsCartSchema)
  );

const setCartItem = (
  page: Page,
  body: {
    readonly expectedRevision: number;
    readonly productId: string;
    readonly quantity: number;
  }
) =>
  Effect.flatMap(
    requestJson(page, { method: "PUT", path: "/api/v1/goods/cart", body }),
    (response) =>
      decodeResponse("updated goods cart", response, goodsCartSchema)
  );

const quoteCart = (page: Page, submittedCode?: string) =>
  Effect.flatMap(
    requestJson(page, {
      method: "POST",
      path: "/api/v1/goods/quote",
      body: { locale: "en-US", ...(submittedCode ? { submittedCode } : {}) },
    }),
    (response) =>
      decodeResponse("goods quote", response, goodsQuoteResponseSchema)
  );

const issueOrder = (page: Page, quoteToken: string) =>
  Effect.flatMap(
    requestJson(page, {
      method: "POST",
      path: "/api/v1/goods/orders",
      body: {
        issuanceId: crypto.randomUUID(),
        quoteToken,
        acknowledged: true,
      },
    }),
    (response) =>
      decodeResponse("issued goods order", response, goodsOrderDetailSchema)
  );

type PaymentResult =
  | { readonly status: "billing_details_required" | "in_progress" | "paid" }
  | { readonly status: "redirect"; readonly redirectUrl: string }
  | { readonly status: "outstanding_order"; readonly orderId: string };

const startPayment = (
  page: Page,
  orderId: string
): Effect.Effect<PaymentResult, unknown> =>
  Effect.gen(function* () {
    const response = yield* requestJson(page, {
      method: "POST",
      path: `/api/v1/goods/orders/${encodeURIComponent(orderId)}/payment`,
      body: {
        locale: "en-US",
        billing: { purpose: "personal", invoice: "requested" },
      },
    });
    return yield* tryWorkspaceE2ESync("decode goods payment response", () => {
      assert(
        response.status === 200,
        `goods payment returned ${response.status}`
      );
      assert(
        response.body && typeof response.body === "object",
        "goods payment response is invalid"
      );
      const candidate = response.body as Record<string, unknown>;
      assert(typeof candidate.status === "string", "payment status is missing");
      if (candidate.status === "redirect") {
        assert(
          typeof candidate.redirectUrl === "string",
          "payment redirect is missing"
        );
        return {
          status: "redirect",
          redirectUrl: candidate.redirectUrl,
        } as const;
      }
      if (candidate.status === "outstanding_order") {
        assert(
          typeof candidate.orderId === "string",
          "outstanding order ID is missing"
        );
        return {
          status: "outstanding_order",
          orderId: candidate.orderId,
        } as const;
      }
      assert(
        candidate.status === "billing_details_required" ||
          candidate.status === "in_progress" ||
          candidate.status === "paid",
        "goods payment status is unknown"
      );
      return { status: candidate.status } as PaymentResult;
    });
  });

const requirePaymentRedirect = (result: PaymentResult) =>
  tryWorkspaceE2ESync("assert goods payment redirect", () => {
    assert(result.status === "redirect", "goods payment did not redirect");
    const url = new URL(result.redirectUrl);
    assert(url.protocol === "https:", "goods payment redirect is not HTTPS");
    return result.redirectUrl;
  });

const assertSafeOrderDetail = (detail: GoodsOrderDetail) =>
  tryWorkspaceE2ESync("assert safe goods order detail", () => {
    assertSafeProjection(detail);
    assert(detail.lines.length > 0, "goods order detail has no lines");
    for (const forbidden of [
      "dotyposCustomerId",
      "activePaymentAttemptId",
      "correlationId",
      "paidAt",
      "writtenOffAt",
    ]) {
      assert(!(forbidden in detail), `goods detail exposed ${forbidden}`);
    }
  });

const assertSafeProjection = (value: object) => {
  for (const forbidden of [
    "dotyposCustomerId",
    "activePaymentAttemptId",
    "correlationId",
    "paidAt",
    "writtenOffAt",
  ]) {
    assert(!(forbidden in value), `goods projection exposed ${forbidden}`);
  }
};

const assertIssuedGoodsEvidence = (
  orderId: GoodsOrderDetail["id"],
  discounted: boolean
) =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const { cartItems, discounts, legal, lines, order, redemptions } =
      yield* runRetrySafeDatabaseOperation(
        "read issued goods evidence",
        Effect.gen(function* () {
          const [order, lines, legal, discounts, redemptions] =
            yield* Effect.all(
              [
                db.select().from(orders).where(eq(orders.id, orderId)).limit(1),
                db
                  .select()
                  .from(orderLines)
                  .where(eq(orderLines.orderId, orderId)),
                db
                  .select()
                  .from(legalEvidenceEvents)
                  .where(eq(legalEvidenceEvents.orderId, orderId)),
                db
                  .select()
                  .from(discountApplications)
                  .where(eq(discountApplications.orderId, orderId)),
                db
                  .select()
                  .from(discountCodeRedemptions)
                  .where(eq(discountCodeRedemptions.orderId, orderId)),
              ],
              { concurrency: "inherit" }
            );
          const cartItems = order[0]
            ? yield* db
                .select({ productId: goodsCartItems.productId })
                .from(goodsCarts)
                .innerJoin(
                  goodsCartItems,
                  eq(goodsCartItems.cartId, goodsCarts.id)
                )
                .where(
                  eq(goodsCarts.dotyposCustomerId, order[0].dotyposCustomerId)
                )
            : [];
          return { cartItems, discounts, legal, lines, order, redemptions };
        })
      );
    yield* tryWorkspaceE2ESync("assert issued goods evidence", () => {
      assert(order[0]?.kind === "goods", "issued order is not goods");
      assert(
        order[0]?.fulfillmentState === "fulfilled",
        "goods order is not fulfilled"
      );
      assert(lines.length > 0, "goods order lines were not persisted");
      assert(
        legal.length === 2 &&
          legal.every(
            ({ accepted, source, workspaceReservationId }) =>
              accepted &&
              source === "goods_order_issue" &&
              workspaceReservationId === null
          ),
        "goods legal evidence is incomplete"
      );
      assert(
        discounted ? discounts.length > 0 : discounts.length === 0,
        "goods discount evidence does not match the quote"
      );
      assert(
        discounted
          ? redemptions.length === 1 && redemptions[0]?.state === "redeemed"
          : redemptions.length === 0,
        "goods discount redemption evidence is invalid"
      );
      assert(cartItems.length === 0, "goods cart items survived issuance");
    });
  });

const assertGoodsPaymentSnapshot = (orderId: GoodsOrderDetail["id"]) =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runRetrySafeDatabaseOperation(
      "read goods accounting snapshot",
      db
        .select({
          orderId: accountingDocumentSnapshots.orderId,
          reservationId: accountingDocumentSnapshots.workspaceReservationId,
        })
        .from(accountingDocumentSnapshots)
        .innerJoin(
          paymentAttempts,
          eq(paymentAttempts.id, accountingDocumentSnapshots.paymentAttemptId)
        )
        .where(eq(paymentAttempts.orderId, orderId))
    );
    yield* tryWorkspaceE2ESync("assert goods accounting snapshot", () => {
      assert(rows.length === 1, "goods accounting snapshot is missing");
      assert(
        rows[0]?.orderId === orderId,
        "snapshot order ownership is invalid"
      );
      assert(
        rows[0]?.reservationId === null,
        "goods snapshot references a reservation"
      );
    });
  });

const assertPaidGoodsAccounting = (orderId: GoodsOrderDetail["id"]) =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const result = yield* pollUntil(
      runRetrySafeDatabaseOperation(
        "read paid goods accounting",
        Effect.all(
          [
            db.select().from(orders).where(eq(orders.id, orderId)).limit(1),
            db.select().from(invoices).where(eq(invoices.orderId, orderId)),
            db
              .select()
              .from(invoiceEmailDeliveries)
              .innerJoin(
                invoices,
                eq(invoices.id, invoiceEmailDeliveries.invoiceId)
              )
              .where(eq(invoices.orderId, orderId)),
            db
              .select()
              .from(paymentAttempts)
              .where(
                and(
                  eq(paymentAttempts.orderId, orderId),
                  eq(paymentAttempts.state, "paid")
                )
              ),
          ],
          { concurrency: "inherit" }
        )
      ).pipe(
        Effect.map(([order, issuedInvoices, deliveries, attempts]) =>
          order[0]?.paymentState === "paid" && issuedInvoices.length === 1
            ? { order, issuedInvoices, deliveries, attempts }
            : undefined
        )
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: "paid goods invoice persistence",
        timeoutMs: 60_000,
      }
    );
    yield* tryWorkspaceE2ESync("assert paid goods accounting", () => {
      assert(
        result.order[0]?.activePaymentAttemptId,
        "paid attempt is not active"
      );
      assert(result.attempts.length === 1, "goods order has no paid attempt");
      assert(
        result.issuedInvoices[0]?.workspaceReservationId === null,
        "goods invoice references a reservation"
      );
      assert(result.deliveries.length > 0, "goods invoice was not dispatched");
    });
  });
