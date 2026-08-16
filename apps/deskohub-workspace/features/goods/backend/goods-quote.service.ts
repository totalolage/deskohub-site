import { createHash } from "node:crypto";
import type { DotyposCustomerId, DotyposProductId } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { workspaceMoneyWithValue } from "@/features/checkout/workspace-money";
import {
  DiscountService,
  type GoodsBasketDiscountCommitment,
  type GoodsDiscountBasketQuote,
} from "@/features/discounts";
import {
  type GoodsCart,
  type GoodsCatalogProduct,
  maximumGoodsOrderMoneyValue,
} from "@/features/goods";
import { getLegalAcceptanceSnapshot } from "@/features/legal/acceptance-snapshot";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  type GoodsQuote,
  type GoodsQuoteRequest,
  type GoodsQuoteResponse,
  goodsQuoteSchema,
} from "../goods-quote";
import { GoodsCartService } from "./goods-cart.service";
import { GoodsCatalogService } from "./goods-catalog.service";
import {
  buildGoodsQuoteState,
  type GoodsQuoteTokenError,
  openGoodsQuoteState,
  sealGoodsQuoteState,
} from "./goods-quote-state";

export class GoodsQuoteUnavailableError extends Data.TaggedError(
  "GoodsQuoteUnavailableError"
)<{
  readonly reason:
    | "dependency_unavailable"
    | "empty_cart"
    | "product_unavailable"
    | "unsafe_total";
  readonly productIds?: readonly DotyposProductId[];
  readonly cause?: unknown;
}> {}

export class GoodsQuoteCustomerMismatchError extends Data.TaggedError(
  "GoodsQuoteCustomerMismatchError"
) {}

export class GoodsQuoteChangedError extends Data.TaggedError(
  "GoodsQuoteChangedError"
)<{ readonly fresh: GoodsQuoteResponse }> {}

export type GoodsQuoteAffirmation = {
  readonly cart: GoodsCart;
  readonly quote: GoodsQuote;
  readonly commitment: GoodsBasketDiscountCommitment;
};

type GoodsQuoteServiceError = GoodsQuoteTokenError | GoodsQuoteUnavailableError;

interface IGoodsQuoteService {
  readonly quote: (
    customerId: DotyposCustomerId,
    request: GoodsQuoteRequest
  ) => Effect.Effect<GoodsQuoteResponse, GoodsQuoteServiceError>;
  readonly openAndAffirm: (
    customerId: DotyposCustomerId,
    token: string
  ) => Effect.Effect<
    GoodsQuoteAffirmation,
    | GoodsQuoteChangedError
    | GoodsQuoteCustomerMismatchError
    | GoodsQuoteServiceError
  >;
}

export class GoodsQuoteService extends Context.Service<
  GoodsQuoteService,
  IGoodsQuoteService
>()("@deskohub-workspace/goods/GoodsQuoteService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const carts = yield* GoodsCartService;
      const catalogs = yield* GoodsCatalogService;
      const discounts = yield* DiscountService;

      const loadQuoteInputs = Effect.fn("GoodsQuoteService.loadInputs")(
        function* (
          customerId: DotyposCustomerId,
          locale: GoodsQuote["locale"]
        ) {
          const cart = yield* carts.get(customerId).pipe(
            Effect.mapError(
              (cause) =>
                new GoodsQuoteUnavailableError({
                  reason: "dependency_unavailable",
                  cause,
                })
            )
          );
          if (cart.items.length === 0) {
            return yield* new GoodsQuoteUnavailableError({
              reason: "empty_cart",
            });
          }

          const { catalog, legalDocuments } = yield* Effect.all(
            {
              catalog: catalogs.getCatalog(locale),
              legalDocuments: getLegalAcceptanceSnapshot(locale),
            },
            { concurrency: "inherit" }
          ).pipe(
            Effect.mapError(
              (cause) =>
                new GoodsQuoteUnavailableError({
                  reason: "dependency_unavailable",
                  cause,
                })
            )
          );
          const products = new Map(
            catalog.categories.flatMap((category) =>
              category.products.map(
                (product) => [product.identity.productId, product] as const
              )
            )
          );
          const missingProductIds = cart.items.flatMap(({ productId }) =>
            products.has(productId) ? [] : [productId]
          );
          if (missingProductIds.length > 0) {
            return yield* new GoodsQuoteUnavailableError({
              reason: "product_unavailable",
              productIds: missingProductIds,
            });
          }

          const lines = yield* Effect.forEach(cart.items, (item) => {
            const product = products.get(item.productId);
            if (!product) return Effect.die("Goods catalog lookup drifted.");
            return getPricedLine(product, item.quantity);
          });
          if (
            lines.reduce(
              (total, line) => total + BigInt(line.undiscountedSubtotal.value),
              0n
            ) > BigInt(maximumGoodsOrderMoneyValue)
          ) {
            return yield* new GoodsQuoteUnavailableError({
              reason: "unsafe_total",
            });
          }

          return {
            cart,
            lines,
            legalDocuments: {
              termsAndConditions: legalDocuments.termsAndConditions,
              operatingRules: legalDocuments.operatingRules,
            },
          };
        }
      );

      const prepareQuote = Effect.fn("GoodsQuoteService.prepare")(
        function* (input: {
          readonly customerId: DotyposCustomerId;
          readonly request: GoodsQuoteRequest;
          readonly displayedDiscountIds?: GoodsQuote["discountIds"];
        }) {
          const loaded = yield* loadQuoteInputs(
            input.customerId,
            input.request.locale
          );
          const basketInput = {
            lines: loaded.lines.map(({ product, undiscountedSubtotal }) => ({
              product: product.identity,
              discountableSubtotal: undiscountedSubtotal,
            })),
            reservationDate: Temporal.Now.instant()
              .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
              .toPlainDate()
              .toString(),
            locale: input.request.locale,
            dotyposCustomerId: input.customerId,
            ...(input.request.submittedCode !== undefined && {
              submittedCode: input.request.submittedCode,
            }),
          };
          const priced = input.displayedDiscountIds
            ? yield* discounts
                .affirmDisplayedGoodsBasketDiscounts({
                  ...basketInput,
                  displayedDiscountIds: input.displayedDiscountIds,
                })
                .pipe(Effect.mapError(toUnavailable))
            : {
                quote: yield* discounts
                  .quoteGoodsBasket(basketInput)
                  .pipe(Effect.mapError(toUnavailable)),
                commitment: undefined,
              };
          const quote = yield* buildGoodsQuote({
            request: input.request,
            cart: loaded.cart,
            products: loaded.lines,
            pricing: priced.quote,
            legalDocuments: loaded.legalDocuments,
          });
          return { ...loaded, quote, commitment: priced.commitment };
        }
      );

      const seal = Effect.fn("GoodsQuoteService.seal")(function* (input: {
        readonly customerId: DotyposCustomerId;
        readonly cart: GoodsCart;
        readonly quote: GoodsQuote;
      }) {
        const state = yield* buildGoodsQuoteState({
          dotyposCustomerId: input.customerId,
          cart: input.cart,
          quote: input.quote,
        });
        const quoteToken = yield* sealGoodsQuoteState(state);
        return { quote: input.quote, quoteToken } satisfies GoodsQuoteResponse;
      });

      const quote = Effect.fn("GoodsQuoteService.quote")(function* (
        customerId: DotyposCustomerId,
        request: GoodsQuoteRequest
      ) {
        const prepared = yield* prepareQuote({ customerId, request });
        return yield* seal({
          customerId,
          cart: prepared.cart,
          quote: prepared.quote,
        });
      });

      const openAndAffirm = Effect.fn("GoodsQuoteService.openAndAffirm")(
        function* (customerId: DotyposCustomerId, token: string) {
          const displayed = yield* openGoodsQuoteState(token);
          if (displayed.dotyposCustomerId !== customerId) {
            return yield* new GoodsQuoteCustomerMismatchError();
          }

          const prepared = yield* prepareQuote({
            customerId,
            request: {
              locale: displayed.quote.locale,
              ...(displayed.quote.submittedCode !== undefined && {
                submittedCode: displayed.quote.submittedCode,
              }),
            },
            displayedDiscountIds: displayed.quote.discountIds,
          });
          if (prepared.quote.fingerprint !== displayed.quote.fingerprint) {
            const fresh = yield* seal({
              customerId,
              cart: prepared.cart,
              quote: prepared.quote,
            });
            return yield* new GoodsQuoteChangedError({ fresh });
          }
          if (!prepared.commitment) {
            return yield* Effect.die(
              "Affirmed goods quote did not return a discount commitment."
            );
          }

          return {
            cart: prepared.cart,
            quote: prepared.quote,
            commitment: prepared.commitment,
          };
        }
      );

      return { openAndAffirm, quote } satisfies IGoodsQuoteService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        GoodsCartService.Live,
        GoodsCatalogService.Live,
        DiscountService.Live
      )
    )
  );
}

type PricedCatalogLine = {
  readonly product: GoodsCatalogProduct;
  readonly quantity: GoodsCart["items"][number]["quantity"];
  readonly undiscountedSubtotal: GoodsQuote["undiscountedTotal"];
};

const getPricedLine = Effect.fn("GoodsQuoteService.priceLine")(function* (
  product: GoodsCatalogProduct,
  quantity: GoodsCart["items"][number]["quantity"]
) {
  const value = BigInt(product.unitPrice.value) * BigInt(quantity);
  if (value > BigInt(maximumGoodsOrderMoneyValue)) {
    return yield* new GoodsQuoteUnavailableError({ reason: "unsafe_total" });
  }
  return {
    product,
    quantity,
    undiscountedSubtotal: workspaceMoneyWithValue(
      Number(value),
      product.unitPrice
    ),
  } satisfies PricedCatalogLine;
});

const buildGoodsQuote = Effect.fn("GoodsQuoteService.buildQuote")(
  function* (input: {
    readonly request: GoodsQuoteRequest;
    readonly cart: GoodsCart;
    readonly products: readonly PricedCatalogLine[];
    readonly pricing: GoodsDiscountBasketQuote;
    readonly legalDocuments: GoodsQuote["legalDocuments"];
  }) {
    if (!goodsPricingFitsPersistence(input.pricing)) {
      return yield* new GoodsQuoteUnavailableError({ reason: "unsafe_total" });
    }
    if (input.products.length !== input.pricing.lines.length) {
      return yield* new GoodsQuoteUnavailableError({
        reason: "dependency_unavailable",
      });
    }
    const lines = yield* Effect.forEach(
      input.products,
      ({ product, quantity }, index) => {
        const pricing = input.pricing.lines[index];
        if (
          !pricing ||
          pricing.product.kind !== "goods" ||
          pricing.product.categoryId !== product.identity.categoryId ||
          pricing.product.productId !== product.identity.productId
        ) {
          return Effect.fail(
            new GoodsQuoteUnavailableError({
              reason: "dependency_unavailable",
            })
          );
        }
        return Effect.succeed({
          product: product.identity,
          name: product.name,
          quantity,
          unitPrice: product.unitPrice,
          undiscountedSubtotal: pricing.discountableSubtotal,
          discounts: pricing.discounts,
          totalDiscount: pricing.totalDiscount,
          total: pricing.discountedSubtotal,
        });
      }
    );
    const unsigned = {
      locale: input.request.locale,
      ...(input.request.submittedCode !== undefined && {
        submittedCode: input.request.submittedCode,
      }),
      cartRevision: input.cart.revision,
      lines,
      discountIds: input.pricing.discountIds,
      undiscountedTotal: input.pricing.discountableSubtotal,
      totalDiscount: input.pricing.totalDiscount,
      total: input.pricing.discountedSubtotal,
      legalDocuments: input.legalDocuments,
    };
    const fingerprint = getGoodsQuoteFingerprint(unsigned);
    return yield* Schema.decodeUnknownEffect(goodsQuoteSchema, {
      onExcessProperty: "error",
    })({ ...unsigned, fingerprint }).pipe(Effect.mapError(toUnavailable));
  }
);

const goodsMoneyFitsPersistence = (money: { readonly value: number }) =>
  Number.isSafeInteger(money.value) &&
  money.value <= maximumGoodsOrderMoneyValue;

const goodsPricingFitsPersistence = (pricing: GoodsDiscountBasketQuote) =>
  [
    pricing.discountableSubtotal,
    pricing.totalDiscount,
    pricing.discountedSubtotal,
    ...pricing.lines.flatMap((line) => [
      line.discountableSubtotal,
      line.totalDiscount,
      line.discountedSubtotal,
      ...line.discounts.flatMap((discount) => [
        discount.subtotalBefore,
        discount.amount,
        discount.subtotalAfter,
      ]),
    ]),
  ].every(goodsMoneyFitsPersistence);

export const getGoodsQuoteFingerprint = (
  quote: Omit<GoodsQuote, "fingerprint">
) => createHash("sha256").update(JSON.stringify(quote)).digest("hex");

const toUnavailable = (cause: unknown) =>
  new GoodsQuoteUnavailableError({
    reason: "dependency_unavailable",
    cause,
  });
