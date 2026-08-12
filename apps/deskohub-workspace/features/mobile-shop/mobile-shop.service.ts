import "server-only";

import { Context, Effect, Layer } from "effect";
import { instantStringSchema } from "@/shared/utils/temporal";
import {
  type IMobileShopCatalogSource,
  MobileShopBrowseCatalogSource,
  MobileShopCatalogPolicy,
  MobileShopCatalogSource,
} from "./backend/catalog-source.service";
import { MobileShopCustomerAccess } from "./backend/customer-access.service";
import { MobileShopPaidFulfillmentService } from "./backend/paid-fulfillment.service";
import {
  type MobileShopPaymentError,
  MobileShopPaymentService,
} from "./backend/payment.service";
import { MobileShopPurchaseRepository } from "./backend/purchase.repository";
import {
  fingerprintMobileShopCart,
  getMobileShopCheckoutAttemptKey,
  normalizeMobileShopCart,
  quoteMobileShopCart,
} from "./cart";
import { mapDotyposMobileShopCatalog } from "./catalog";
import {
  type MobileShopAccount,
  type MobileShopCreateOrderRequest,
  type MobileShopHistoryCursor,
  type MobileShopLocale,
  type MobileShopOrderHistory,
  type MobileShopOrderSummary,
  type MobileShopPaymentSession,
  type MobileShopPurchaseId,
  type MobileShopQuote,
  type MobileShopQuoteRequest,
  mobileShopPublicReferenceSchema,
} from "./contracts";
import { MobileShopEntitlementService } from "./eligibility";
import { MobileShopFailure } from "./errors";

export interface IMobileShopService {
  readonly account: (
    request: Request
  ) => Effect.Effect<MobileShopAccount, MobileShopFailure>;
  readonly catalog: (input: {
    readonly request: Request;
    readonly locale: MobileShopLocale;
  }) => Effect.Effect<
    ReturnType<typeof mapDotyposMobileShopCatalog>["catalog"],
    MobileShopFailure
  >;
  readonly quote: (input: {
    readonly request: Request;
    readonly quoteRequest: MobileShopQuoteRequest;
  }) => Effect.Effect<MobileShopQuote, MobileShopFailure>;
  readonly createOrder: (input: {
    readonly request: Request;
    readonly orderRequest: MobileShopCreateOrderRequest;
  }) => Effect.Effect<MobileShopOrderSummary, MobileShopFailure>;
  readonly history: (input: {
    readonly request: Request;
    readonly cursor?: MobileShopHistoryCursor;
    readonly limit?: number;
  }) => Effect.Effect<MobileShopOrderHistory, MobileShopFailure>;
  readonly order: (input: {
    readonly request: Request;
    readonly orderId: MobileShopPurchaseId;
  }) => Effect.Effect<MobileShopOrderSummary, MobileShopFailure>;
  readonly payment: (input: {
    readonly request: Request;
    readonly orderId: MobileShopPurchaseId;
  }) => Effect.Effect<MobileShopPaymentSession, MobileShopFailure>;
}

export const createMobileShopHistoryPage = <
  const Order extends { readonly createdAt: string; readonly id: string },
>(
  orders: readonly Order[],
  limit: number
) => {
  const page = orders.slice(0, limit);
  const last = page.at(-1);
  return orders.length > limit && last
    ? { orders: page, nextCursor: JSON.stringify([last.createdAt, last.id]) }
    : { orders: page };
};

export class MobileShopService extends Context.Service<
  MobileShopService,
  IMobileShopService
>()("@deskohub-workspace/mobile-shop/MobileShopService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const access = yield* MobileShopCustomerAccess;
      const entitlement = yield* MobileShopEntitlementService;
      const catalogSource = yield* MobileShopCatalogSource;
      const browseCatalogSource = yield* MobileShopBrowseCatalogSource;
      const catalogPolicy = yield* MobileShopCatalogPolicy;
      const purchases = yield* MobileShopPurchaseRepository;
      const payments = yield* MobileShopPaymentService;
      const fulfillment = yield* MobileShopPaidFulfillmentService;

      const loadCatalog = Effect.fn("MobileShopService.loadCatalog")(function* (
        locale: MobileShopLocale,
        source: IMobileShopCatalogSource
      ) {
        const [snapshot, policy] = yield* Effect.all(
          [source.loadAll, catalogPolicy.current],
          { concurrency: "inherit" }
        );
        return {
          catalog: mapDotyposMobileShopCatalog({
            ...snapshot,
            locale,
            generatedAt: snapshot.generatedAt ?? Temporal.Now.instant(),
            policy,
          }).catalog,
          policy,
        };
      });

      const quoteCurrentCart = Effect.fn("MobileShopService.quoteCurrentCart")(
        function* (input: MobileShopQuoteRequest) {
          const current = yield* loadCatalog(input.locale, catalogSource);
          return yield* quoteMobileShopCart({
            cart: input.cart,
            catalog: current.catalog,
            locale: input.locale,
            taxRegime: current.policy.taxRegime,
            now: Temporal.Now.instant(),
          });
        }
      );

      const requireLinkedAccount = Effect.fn(
        "MobileShopService.requireLinkedAccount"
      )(function* (request: Request) {
        const account = yield* access.resolve(request);
        if (account.customerLink.kind !== "linked") {
          return yield* new MobileShopFailure({
            code: "commerce_identity_unavailable",
          });
        }
        return { customerId: account.customerLink.customerId };
      });

      const requireCommerce = Effect.fn("MobileShopService.requireCommerce")(
        function* (request: Request) {
          const account = yield* requireLinkedAccount(request);
          const current = yield* entitlement.evaluate({
            customerId: account.customerId,
            now: Temporal.Now.instant(),
          });
          if (current.kind !== "eligible") {
            return yield* new MobileShopFailure({
              code: "no_active_reservation",
            });
          }
          return { ...account, entitlement: current };
        }
      );

      const account = Effect.fn("MobileShopService.account")(function* (
        request: Request
      ) {
        const authenticated = yield* access.resolve(request);
        if (authenticated.customerLink.kind !== "linked") {
          return {
            authenticated: true,
            webMutation: {
              headerName: "x-deskohub-csrf",
              headerValue: "1",
            },
            commerceIdentity: { kind: "unavailable" },
            entitlement: {
              kind: "locked",
              reason: "commerce_identity_unavailable",
            },
          } satisfies MobileShopAccount;
        }

        const current = yield* entitlement.evaluate({
          customerId: authenticated.customerLink.customerId,
          now: Temporal.Now.instant(),
        });
        return current.kind === "eligible"
          ? ({
              authenticated: true,
              webMutation: {
                headerName: "x-deskohub-csrf",
                headerValue: "1",
              },
              commerceIdentity: { kind: "linked" },
              entitlement: {
                kind: "eligible",
                day: current.day.date,
                reservationId: current.reservationId,
                validUntil: instantStringSchema.make(
                  current.day.endsAt.toString()
                ),
              },
            } satisfies MobileShopAccount)
          : ({
              authenticated: true,
              webMutation: {
                headerName: "x-deskohub-csrf",
                headerValue: "1",
              },
              commerceIdentity: { kind: "linked" },
              entitlement: {
                kind: "locked",
                reason: "no_active_reservation",
              },
            } satisfies MobileShopAccount);
      });

      const catalog = Effect.fn("MobileShopService.catalog")(function* (input: {
        readonly request: Request;
        readonly locale: MobileShopLocale;
      }) {
        yield* requireCommerce(input.request);
        return (yield* loadCatalog(input.locale, browseCatalogSource)).catalog;
      });

      const quote = Effect.fn("MobileShopService.quote")(function* (input: {
        readonly request: Request;
        readonly quoteRequest: MobileShopQuoteRequest;
      }) {
        yield* requireCommerce(input.request);
        return yield* quoteCurrentCart(input.quoteRequest);
      });

      const createOrder = Effect.fn("MobileShopService.createOrder")(
        function* (input: {
          readonly request: Request;
          readonly orderRequest: MobileShopCreateOrderRequest;
        }) {
          const authorized = yield* requireCommerce(input.request);
          if (
            Temporal.Instant.compare(
              Temporal.Instant.from(input.orderRequest.quoteExpiresAt),
              Temporal.Now.instant()
            ) <= 0
          ) {
            return yield* new MobileShopFailure({ code: "catalog_changed" });
          }
          const normalizedCart = yield* normalizeMobileShopCart(
            input.orderRequest.cart
          );
          const affirmedQuote = yield* quoteCurrentCart({
            locale: input.orderRequest.locale,
            cart: normalizedCart,
          });
          if (
            affirmedQuote.fingerprint !== input.orderRequest.quoteFingerprint
          ) {
            return yield* new MobileShopFailure({ code: "catalog_changed" });
          }

          const result = yield* purchases
            .create({
              publicReference: createPublicReference(),
              dotyposCustomerId: authorized.customerId,
              authorizingDotyposReservationId:
                authorized.entitlement.reservationId,
              checkoutAttemptKey: getMobileShopCheckoutAttemptKey({
                customerId: authorized.customerId,
                checkoutAttemptId: input.orderRequest.checkoutAttemptId,
              }),
              cartFingerprint: fingerprintMobileShopCart(normalizedCart),
              quote: affirmedQuote,
            })
            .pipe(Effect.mapError(mapPersistenceFailure));
          if (result.kind === "conflict") {
            return yield* new MobileShopFailure({
              code: "idempotency_conflict",
            });
          }
          return result.order;
        }
      );

      const history = Effect.fn("MobileShopService.history")(function* (input: {
        readonly request: Request;
        readonly cursor?: MobileShopHistoryCursor;
        readonly limit?: number;
      }) {
        const customer = yield* requireLinkedAccount(input.request);
        const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 20)));
        const orders = yield* purchases
          .listOwned({
            dotyposCustomerId: customer.customerId,
            cursor: input.cursor,
            limit: limit + 1,
          })
          .pipe(Effect.mapError(mapPersistenceFailure));
        return createMobileShopHistoryPage(orders, limit);
      });

      const order = Effect.fn("MobileShopService.order")(function* (input: {
        readonly request: Request;
        readonly orderId: MobileShopPurchaseId;
      }) {
        const customer = yield* requireLinkedAccount(input.request);
        const found = yield* purchases
          .findOwned({
            id: input.orderId,
            dotyposCustomerId: customer.customerId,
          })
          .pipe(Effect.mapError(mapPersistenceFailure));
        if (!found) {
          return yield* new MobileShopFailure({ code: "order_not_found" });
        }
        if (found.paymentState === "pending") {
          yield* payments
            .reconcilePayment({
              purchaseId: found.id,
              customerId: customer.customerId,
            })
            .pipe(
              Effect.tapError((cause) =>
                Effect.logWarning(
                  "Mobile shop payment reconciliation was unavailable",
                  { cause, purchaseId: found.id }
                )
              ),
              Effect.ignore
            );
        }

        const current =
          (yield* purchases
            .findOwned({
              id: input.orderId,
              dotyposCustomerId: customer.customerId,
            })
            .pipe(Effect.mapError(mapPersistenceFailure))) ?? found;
        if (current.paymentState !== "paid") return current;

        yield* fulfillment.fulfillPaidPurchase({ purchaseId: current.id });
        return (
          (yield* purchases
            .findOwned({
              id: input.orderId,
              dotyposCustomerId: customer.customerId,
            })
            .pipe(Effect.mapError(mapPersistenceFailure))) ?? current
        );
      });

      const payment = Effect.fn("MobileShopService.payment")(function* (input: {
        readonly request: Request;
        readonly orderId: MobileShopPurchaseId;
      }) {
        const customer = yield* requireCommerce(input.request);
        const owned = yield* purchases
          .findOwned({
            id: input.orderId,
            dotyposCustomerId: customer.customerId,
          })
          .pipe(Effect.mapError(mapPersistenceFailure));
        if (!owned) {
          return yield* new MobileShopFailure({ code: "order_not_found" });
        }
        return yield* payments
          .startPayment({
            purchaseId: owned.id,
            customerId: customer.customerId,
          })
          .pipe(Effect.mapError(mapPaymentFailure));
      });

      return {
        account,
        catalog,
        quote,
        createOrder,
        history,
        order,
        payment,
      } satisfies IMobileShopService;
    })
  );

  static Unavailable = Layer.succeed(this, makeUnavailableService());
}

const createPublicReference = () =>
  mobileShopPublicReferenceSchema.make(
    `DW-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`
  );

const mapPersistenceFailure = (cause: unknown) =>
  new MobileShopFailure({ code: "service_unavailable", cause });

const mapPaymentFailure = (cause: MobileShopPaymentError) =>
  new MobileShopFailure({
    code:
      cause.reason === "already_paid" || cause.reason === "in_progress"
        ? "payment_pending"
        : "payment_unavailable",
    cause,
  });

function makeUnavailableService(): IMobileShopService {
  const unavailable = () =>
    Effect.fail(
      MobileShopFailure.integrationUnavailable(
        "The mobile shop server integrations have not been installed."
      )
    );

  return {
    account: unavailable,
    catalog: unavailable,
    quote: unavailable,
    createOrder: unavailable,
    history: unavailable,
    order: unavailable,
    payment: unavailable,
  };
}
