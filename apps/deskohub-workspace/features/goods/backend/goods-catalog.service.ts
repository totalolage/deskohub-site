import {
  type DotyposCategory,
  type DotyposProduct,
  DotyposService,
} from "@deskohub/dotypos";
import { BigDecimal, Context, Data, Effect, Layer, Schema } from "effect";
import { currencyCZK } from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import type {
  GoodsCatalog,
  GoodsCatalogCategory,
  GoodsCatalogProduct,
} from "../goods-catalog";

export class GoodsCatalogUnavailableError extends Data.TaggedError(
  "GoodsCatalogUnavailableError"
)<{ readonly cause: unknown }> {}

interface IGoodsCatalogService {
  readonly getCatalog: (
    locale: Locale
  ) => Effect.Effect<GoodsCatalog, GoodsCatalogUnavailableError>;
}

export class GoodsCatalogService extends Context.Service<
  GoodsCatalogService,
  IGoodsCatalogService
>()("@deskohub-workspace/goods/GoodsCatalogService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;

      const getCatalog = Effect.fn("GoodsCatalogService.getCatalog")(
        (locale: Locale) =>
          Effect.all(
            [
              dotypos.getCategories(),
              dotypos.getProducts({ includeDeleted: true }),
            ],
            { concurrency: "inherit" }
          ).pipe(
            Effect.flatMap(([categories, products]) =>
              projectGoodsCatalog({ categories, locale, products })
            ),
            Effect.mapError(
              (cause) => new GoodsCatalogUnavailableError({ cause })
            )
          )
      );

      return { getCatalog } satisfies IGoodsCatalogService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDotyposLayer));
}

const projectGoodsCatalog = Effect.fn("GoodsCatalogService.projectCatalog")(
  function* (input: {
    readonly categories: readonly DotyposCategory[];
    readonly locale: Locale;
    readonly products: readonly DotyposProduct[];
  }) {
    const visibleProducts = input.products.filter(isVisibleProviderEntity);
    const categories: GoodsCatalogCategory[] = [];

    for (const category of input.categories) {
      if (!(category.id && isVisibleProviderEntity(category))) continue;
      const name = getLocalizedName(category, input.locale);
      if (!name) continue;

      const products: GoodsCatalogProduct[] = [];
      for (const product of visibleProducts) {
        if (!(product.id && product._categoryId === category.id)) continue;
        const productName = getLocalizedName(product, input.locale);
        if (!productName) continue;
        const unitPrice = yield* decodeDotyposCzkPrice(
          product.priceWithVat ?? product.priceWithoutVat
        );
        const description = getLocalizedDescription(product, input.locale);
        const imageUrl = getProviderImageUrl(product.imageUrl);
        const unit = getOptionalTrimmedText(product.unit);
        products.push({
          identity: {
            kind: "goods",
            categoryId: category.id,
            productId: product.id,
          },
          name: productName,
          ...(description && { description }),
          ...(imageUrl && { imageUrl }),
          ...(unit && { unit }),
          unitPrice,
        });
      }

      if (products.length > 0) {
        categories.push({ categoryId: category.id, name, products });
      }
    }

    return { categories } satisfies GoodsCatalog;
  }
);

const isVisibleProviderEntity = (entity: {
  readonly deleted?: boolean | null;
  readonly display?: boolean | null;
}) => entity.deleted !== true && entity.display !== false;

const getLocalizedName = (
  entity: {
    readonly name?: string;
    readonly translatedName?: Readonly<Record<string, string>> | null;
  },
  locale: Locale
) => {
  const language = locale.slice(0, 2);
  const candidates = [
    entity.translatedName?.[locale],
    entity.translatedName?.[language],
    entity.name,
  ];
  return candidates.find((candidate) => candidate?.trim())?.trim();
};

const getLocalizedDescription = (product: DotyposProduct, locale: Locale) => {
  const language = locale.slice(0, 2);
  return getOptionalTrimmedText(
    product.translatedDescription?.[locale] ??
      product.translatedDescription?.[language] ??
      product.description
  );
};

const getProviderImageUrl = (value: string | null | undefined) => {
  const imageUrl = getOptionalTrimmedText(value);
  if (!imageUrl || !URL.canParse(imageUrl)) return undefined;
  const protocol = new URL(imageUrl).protocol;
  return protocol === "http:" || protocol === "https:" ? imageUrl : undefined;
};

const getOptionalTrimmedText = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const hundred = BigDecimal.fromBigInt(BigInt(100));
const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

const dotyposCzkPriceSchema = Schema.BigDecimalFromString.check(
  Schema.makeFilter(
    (price) => {
      const minorValue = BigDecimal.scale(
        BigDecimal.multiply(price, hundred),
        0
      ).value;
      return (
        BigDecimal.isInteger(BigDecimal.multiply(price, hundred)) &&
        minorValue > BigInt(0) &&
        minorValue <= maximumSafeInteger
      );
    },
    { message: "Dotypos price must be a positive exact CZK minor-unit amount" }
  )
);

const decodeDotyposCzkPrice = (price: string) =>
  Schema.decodeUnknownEffect(dotyposCzkPriceSchema)(price).pipe(
    Effect.map((decoded) =>
      currencyCZK(
        Number(BigDecimal.scale(BigDecimal.multiply(decoded, hundred), 0).value)
      )
    )
  );
