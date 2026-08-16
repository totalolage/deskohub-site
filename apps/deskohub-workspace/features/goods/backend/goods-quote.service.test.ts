import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposCustomerIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import {
  DiscountService,
  type GoodsBasketDiscountCommitment,
  type GoodsDiscountBasketInput,
  type GoodsDiscountBasketQuote,
} from "@/features/discounts";
import { makeGoodsBasketDiscountCommitment } from "@/features/discounts/commitment";
import type { GoodsCart, GoodsCatalog } from "@/features/goods";
import { workspaceSiteConstants } from "@/shared/utils";
import type { GoodsQuote } from "../goods-quote";
import { GoodsCartService } from "./goods-cart.service";
import { GoodsCatalogService } from "./goods-catalog.service";
import {
  type GoodsQuoteChangedError,
  GoodsQuoteCustomerMismatchError,
  GoodsQuoteService,
  GoodsQuoteUnavailableError,
  getGoodsQuoteFingerprint,
} from "./goods-quote.service";

const customerId = DotyposCustomerIdSchema.make("customer-1");
const otherCustomerId = DotyposCustomerIdSchema.make("customer-2");
const categoryId = DotyposCategoryIdSchema.make("category-1");
const productId = DotyposProductIdSchema.make("product-1");
const money = (value: number): WorkspaceMoney => ({
  value,
  exponent: 2,
  currency: "CZK",
});
const product = {
  identity: { kind: "goods" as const, categoryId, productId },
  name: "Sandwich",
  unitPrice: money(12_500),
};

const price = (input: GoodsDiscountBasketInput): GoodsDiscountBasketQuote => {
  const total = input.lines.reduce(
    (sum, line) => sum + line.discountableSubtotal.value,
    0
  );
  return {
    lines: input.lines.map((line) => ({
      product: line.product,
      discountableSubtotal: line.discountableSubtotal,
      discounts: [],
      totalDiscount: money(0),
      discountedSubtotal: line.discountableSubtotal,
    })),
    discountIds: [],
    discountableSubtotal: money(total),
    totalDiscount: money(0),
    discountedSubtotal: money(total),
  };
};

const emptyCommitmentFor = (quote: GoodsDiscountBasketQuote) =>
  makeGoodsBasketDiscountCommitment({ quote, applications: [] });

const makeLayer = (input: {
  readonly getCart: () => Effect.Effect<GoodsCart>;
  readonly getCatalog: () => Effect.Effect<GoodsCatalog>;
  readonly quote?: (
    basket: GoodsDiscountBasketInput
  ) => Effect.Effect<GoodsDiscountBasketQuote>;
  readonly affirm?: (
    basket: GoodsDiscountBasketInput & {
      readonly displayedDiscountIds: GoodsQuote["discountIds"];
    }
  ) => Effect.Effect<{
    readonly quote: GoodsDiscountBasketQuote;
    readonly commitment: GoodsBasketDiscountCommitment;
  }>;
}) =>
  GoodsQuoteService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(GoodsCartService, { get: input.getCart }),
        Layer.mock(GoodsCatalogService, {
          getCatalog: input.getCatalog,
        }),
        Layer.mock(DiscountService, {
          quoteGoodsBasket:
            input.quote ?? ((basket) => Effect.succeed(price(basket))),
          affirmDisplayedGoodsBasketDiscounts:
            input.affirm ??
            ((basket) => {
              const quote = price(basket);
              return Effect.succeed({
                quote,
                commitment: emptyCommitmentFor(quote),
              });
            }),
        })
      )
    )
  );

const run = <A, E>(
  effect: Effect.Effect<A, E, GoodsQuoteService>,
  layer: ReturnType<typeof makeLayer>
) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

const initialCart: GoodsCart = {
  revision: 1,
  items: [{ productId, quantity: 2 }],
};
const initialCatalog: GoodsCatalog = {
  categories: [
    {
      categoryId,
      name: "Food",
      products: [product],
    },
  ],
};

describe("GoodsQuoteService", () => {
  test("reads each provider once and returns exact line totals", async () => {
    const getCart = mock(() => Effect.succeed(initialCart));
    const getCatalog = mock(() => Effect.succeed(initialCatalog));
    const quoteGoodsBasket = mock((basket: GoodsDiscountBasketInput) =>
      Effect.succeed(price(basket))
    );
    const layer = makeLayer({
      getCart,
      getCatalog,
      quote: quoteGoodsBasket,
    });

    const result = await run(
      Effect.flatMap(GoodsQuoteService, (service) =>
        service.quote(customerId, { locale: "en-US" })
      ),
      layer
    );

    expect(result.quote.lines[0]).toMatchObject({
      product: product.identity,
      quantity: 2,
      unitPrice: money(12_500),
      undiscountedSubtotal: money(25_000),
      total: money(25_000),
    });
    expect(result.quote.total).toEqual(money(25_000));
    expect(result.quote.legalDocuments.termsAndConditions.hash).toHaveLength(
      64
    );
    expect(getCart).toHaveBeenCalledTimes(1);
    expect(getCatalog).toHaveBeenCalledTimes(1);
    expect(quoteGoodsBasket).toHaveBeenCalledTimes(1);
    expect(quoteGoodsBasket.mock.calls[0]?.[0].reservationDate).toBe(
      Temporal.Now.instant()
        .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
        .toPlainDate()
        .toString()
    );
  });

  test("rejects empty and missing catalog products before pricing", async () => {
    const quoteGoodsBasket = mock((basket: GoodsDiscountBasketInput) =>
      Effect.succeed(price(basket))
    );
    const emptyLayer = makeLayer({
      getCart: () => Effect.succeed({ revision: 0, items: [] }),
      getCatalog: () => Effect.succeed(initialCatalog),
      quote: quoteGoodsBasket,
    });
    const missingLayer = makeLayer({
      getCart: () => Effect.succeed(initialCart),
      getCatalog: () => Effect.succeed({ categories: [] }),
      quote: quoteGoodsBasket,
    });

    await expect(
      run(
        Effect.flatMap(GoodsQuoteService, (service) =>
          service.quote(customerId, { locale: "en-US" })
        ),
        emptyLayer
      )
    ).rejects.toEqual(new GoodsQuoteUnavailableError({ reason: "empty_cart" }));
    await expect(
      run(
        Effect.flatMap(GoodsQuoteService, (service) =>
          service.quote(customerId, { locale: "en-US" })
        ),
        missingLayer
      )
    ).rejects.toMatchObject({
      _tag: "GoodsQuoteUnavailableError",
      reason: "product_unavailable",
      productIds: [productId],
    });
    expect(quoteGoodsBasket).not.toHaveBeenCalled();
  });

  test("rejects line and basket safe-integer overflow", async () => {
    const unsafeCatalog: GoodsCatalog = {
      categories: [
        {
          categoryId,
          name: "Food",
          products: [
            {
              ...product,
              unitPrice: money(Number.MAX_SAFE_INTEGER),
            },
          ],
        },
      ],
    };
    const layer = makeLayer({
      getCart: () => Effect.succeed(initialCart),
      getCatalog: () => Effect.succeed(unsafeCatalog),
    });

    await expect(
      run(
        Effect.flatMap(GoodsQuoteService, (service) =>
          service.quote(customerId, { locale: "en-US" })
        ),
        layer
      )
    ).rejects.toEqual(
      new GoodsQuoteUnavailableError({ reason: "unsafe_total" })
    );
  });

  test("rejects totals that do not fit persisted order money", async () => {
    const unpersistableCatalog: GoodsCatalog = {
      categories: [
        {
          categoryId,
          name: "Food",
          products: [
            {
              ...product,
              unitPrice: money(2_147_483_648),
            },
          ],
        },
      ],
    };
    const layer = makeLayer({
      getCart: () => Effect.succeed(initialCart),
      getCatalog: () => Effect.succeed(unpersistableCatalog),
    });

    await expect(
      run(
        Effect.flatMap(GoodsQuoteService, (service) =>
          service.quote(customerId, { locale: "en-US" })
        ),
        layer
      )
    ).rejects.toEqual(
      new GoodsQuoteUnavailableError({ reason: "unsafe_total" })
    );
  });

  test("rejects discount pricing that does not fit persisted order money", async () => {
    const layer = makeLayer({
      getCart: () => Effect.succeed(initialCart),
      getCatalog: () => Effect.succeed(initialCatalog),
      quote: (basket) => {
        const quoted = price(basket);
        return Effect.succeed({
          ...quoted,
          lines: quoted.lines.map((line) => ({
            ...line,
            totalDiscount: money(2_147_483_648),
          })),
        });
      },
    });

    await expect(
      run(
        Effect.flatMap(GoodsQuoteService, (service) =>
          service.quote(customerId, { locale: "en-US" })
        ),
        layer
      )
    ).rejects.toEqual(
      new GoodsQuoteUnavailableError({ reason: "unsafe_total" })
    );
  });

  test("freshly affirms displayed discounts and returns a fresh token on drift", async () => {
    let catalog = initialCatalog;
    const affirm = mock(
      (
        basket: GoodsDiscountBasketInput & {
          readonly displayedDiscountIds: GoodsQuote["discountIds"];
        }
      ) => {
        const quote = price(basket);
        return Effect.succeed({
          quote,
          commitment: emptyCommitmentFor(quote),
        });
      }
    );
    const layer = makeLayer({
      getCart: () => Effect.succeed(initialCart),
      getCatalog: () => Effect.succeed(catalog),
      affirm,
    });
    const displayed = await run(
      Effect.flatMap(GoodsQuoteService, (service) =>
        service.quote(customerId, { locale: "en-US" })
      ),
      layer
    );
    catalog = {
      categories: [
        {
          categoryId,
          name: "Food",
          products: [{ ...product, unitPrice: money(13_000) }],
        },
      ],
    };

    await expect(
      run(
        Effect.flatMap(GoodsQuoteService, (service) =>
          service.openAndAffirm(customerId, displayed.quoteToken)
        ),
        layer
      )
    ).rejects.toMatchObject({
      _tag: "GoodsQuoteChangedError",
      fresh: { quote: { total: money(26_000) } },
    } satisfies Partial<GoodsQuoteChangedError>);
    expect(affirm).toHaveBeenCalledTimes(1);
  });

  test("treats an authoritative catalog category move as quote drift", async () => {
    let catalog = initialCatalog;
    const layer = makeLayer({
      getCart: () => Effect.succeed(initialCart),
      getCatalog: () => Effect.succeed(catalog),
    });
    const displayed = await run(
      Effect.flatMap(GoodsQuoteService, (service) =>
        service.quote(customerId, { locale: "en-US" })
      ),
      layer
    );
    const movedCategoryId = DotyposCategoryIdSchema.make("category-2");
    catalog = {
      categories: [
        {
          categoryId: movedCategoryId,
          name: "Cafe",
          products: [
            {
              ...product,
              identity: {
                ...product.identity,
                categoryId: movedCategoryId,
              },
            },
          ],
        },
      ],
    };

    await expect(
      run(
        Effect.flatMap(GoodsQuoteService, (service) =>
          service.openAndAffirm(customerId, displayed.quoteToken)
        ),
        layer
      )
    ).rejects.toMatchObject({
      _tag: "GoodsQuoteChangedError",
      fresh: {
        quote: { lines: [{ product: { categoryId: movedCategoryId } }] },
      },
    });
  });

  test("returns typed unavailability when an affirmed cart empties or loses a product", async () => {
    let cart = initialCart;
    let catalog = initialCatalog;
    const layer = makeLayer({
      getCart: () => Effect.succeed(cart),
      getCatalog: () => Effect.succeed(catalog),
    });
    const displayed = await run(
      Effect.flatMap(GoodsQuoteService, (service) =>
        service.quote(customerId, { locale: "en-US" })
      ),
      layer
    );

    cart = { revision: 2, items: [] };
    await expect(
      run(
        Effect.flatMap(GoodsQuoteService, (service) =>
          service.openAndAffirm(customerId, displayed.quoteToken)
        ),
        layer
      )
    ).rejects.toMatchObject({
      _tag: "GoodsQuoteUnavailableError",
      reason: "empty_cart",
    });

    cart = { revision: 3, items: initialCart.items };
    catalog = { categories: [] };
    await expect(
      run(
        Effect.flatMap(GoodsQuoteService, (service) =>
          service.openAndAffirm(customerId, displayed.quoteToken)
        ),
        layer
      )
    ).rejects.toMatchObject({
      _tag: "GoodsQuoteUnavailableError",
      reason: "product_unavailable",
    });
  });

  test("rejects a different customer before cart, catalog, or pricing access", async () => {
    const getCart = mock(() => Effect.succeed(initialCart));
    const getCatalog = mock(() => Effect.succeed(initialCatalog));
    const affirm = mock((basket: GoodsDiscountBasketInput) => {
      const quote = price(basket);
      return Effect.succeed({
        quote,
        commitment: emptyCommitmentFor(quote),
      });
    });
    const layer = makeLayer({ getCart, getCatalog, affirm });
    const displayed = await run(
      Effect.flatMap(GoodsQuoteService, (service) =>
        service.quote(customerId, { locale: "en-US" })
      ),
      layer
    );
    getCart.mockClear();
    getCatalog.mockClear();

    await expect(
      run(
        Effect.flatMap(GoodsQuoteService, (service) =>
          service.openAndAffirm(otherCustomerId, displayed.quoteToken)
        ),
        layer
      )
    ).rejects.toEqual(new GoodsQuoteCustomerMismatchError());
    expect(getCart).not.toHaveBeenCalled();
    expect(getCatalog).not.toHaveBeenCalled();
    expect(affirm).not.toHaveBeenCalled();
  });

  test("fingerprints cart, locale, submitted code, and legal document hashes", () => {
    const quote = makeFingerprintQuote();
    const changedCart = {
      ...quote,
      cartRevision: quote.cartRevision + 1,
      lines: [{ ...quote.lines[0]!, quantity: 3 }],
    };
    const changedLocale = { ...quote, locale: "cs-CZ" as const };
    const changedCode = {
      ...quote,
      submittedCode: "LUNCH10" as GoodsQuote["submittedCode"],
    };
    const changedLegal = {
      ...quote,
      legalDocuments: {
        ...quote.legalDocuments,
        termsAndConditions: {
          ...quote.legalDocuments.termsAndConditions,
          hash: "b".repeat(64),
        },
      },
    };

    expect(getGoodsQuoteFingerprint(changedCart)).not.toBe(
      getGoodsQuoteFingerprint(quote)
    );
    expect(getGoodsQuoteFingerprint(changedLocale)).not.toBe(
      getGoodsQuoteFingerprint(quote)
    );
    expect(getGoodsQuoteFingerprint(changedCode)).not.toBe(
      getGoodsQuoteFingerprint(quote)
    );
    expect(getGoodsQuoteFingerprint(changedLegal)).not.toBe(
      getGoodsQuoteFingerprint(quote)
    );
  });
});

const makeFingerprintQuote = (): Omit<GoodsQuote, "fingerprint"> => ({
  locale: "en-US",
  cartRevision: 1,
  lines: [
    {
      product: product.identity,
      name: product.name,
      quantity: 2,
      unitPrice: product.unitPrice,
      undiscountedSubtotal: money(25_000),
      discounts: [],
      totalDiscount: money(0),
      total: money(25_000),
    },
  ],
  discountIds: [],
  undiscountedTotal: money(25_000),
  totalDiscount: money(0),
  total: money(25_000),
  legalDocuments: {
    termsAndConditions: legalDocument("terms-and-conditions", "a".repeat(64)),
    operatingRules: legalDocument("operating-rules", "c".repeat(64)),
  },
});

const legalDocument = (path: string, hash: string) => ({
  path: `/en-US/${path}`,
  url: `https://workspace.deskohub.cz/en-US/${path}`,
  title: path,
  updatedAt: "2026-01-01",
  hash,
  hashAlgorithm: "sha256" as const,
});
