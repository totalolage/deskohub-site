import type {
  DotyposCategory,
  DotyposProduct,
  DotyposProductId,
} from "@deskohub/dotypos";
import { getTranslatedValue } from "@deskohub/i18n/translatable";
import { BigDecimal, Option, Schema, SchemaGetter } from "effect";
import { czkCurrency } from "@/shared/money/currencies";
import { instantStringSchema } from "@/shared/utils/temporal";
import type {
  MobileShopCatalog,
  MobileShopCatalogCategory,
  MobileShopCatalogProduct,
  MobileShopLocale,
  SellerTaxRegime,
} from "./contracts";

export const mobileShopCatalogTag = "self-service" as const;

const defaultDeniedProductTags = ["alcohol", "staff-prepared"] as const;

const positiveDotyposPriceSchema = Schema.String.check(
  Schema.isPattern(/^\d+(?:\.\d+)?$/)
).pipe(
  Schema.decodeTo(
    Schema.BigDecimalFromString.check(
      Schema.isGreaterThanBigDecimal(BigDecimal.fromBigInt(BigInt(0))),
      Schema.makeFilter(
        (price) =>
          BigDecimal.isInteger(
            BigDecimal.multiply(
              price,
              BigDecimal.fromBigInt(BigInt(10 ** czkCurrency.exponent))
            )
          ),
        { message: "must convert exactly to whole CZK minor units" }
      )
    )
  ),
  Schema.decodeTo(Schema.Int.check(Schema.isGreaterThan(0)), {
    decode: SchemaGetter.transform((price) =>
      Number(
        BigDecimal.scale(
          BigDecimal.multiply(
            price,
            BigDecimal.fromBigInt(BigInt(10 ** czkCurrency.exponent))
          ),
          0
        ).value
      )
    ),
    encode: SchemaGetter.transform((minorUnits) =>
      BigDecimal.make(BigInt(minorUnits), czkCurrency.exponent)
    ),
  })
);

const decodePositiveDotyposPrice = Schema.decodeUnknownOption(
  positiveDotyposPriceSchema
);

export type MobileShopFinalPriceField = "priceWithoutVat" | "priceWithVat";

export interface MobileShopCatalogMappingPolicy {
  /**
   * Must be selected only after verifying the active Desktechub Dotypos cloud.
   * Keeping it required prevents provider terminology from silently deciding
   * the legal selling price.
   */
  readonly finalPriceField: MobileShopFinalPriceField;
  readonly taxRegime: SellerTaxRegime;
  readonly deniedProductTags?: readonly string[];
}

export interface MobileShopStockFulfillmentFact {
  readonly productId: DotyposProductId;
  readonly stockDeductionEnabled: boolean;
  readonly role: "backend-informative-only";
}

export interface MappedMobileShopCatalog {
  readonly catalog: MobileShopCatalog;
  /** Never serialize this map in customer catalog or order DTOs. */
  readonly stockFulfillmentFacts: ReadonlyMap<
    DotyposProductId,
    MobileShopStockFulfillmentFact
  >;
}

export const mapDotyposMobileShopCatalog = (input: {
  readonly categories: readonly DotyposCategory[];
  readonly products: readonly DotyposProduct[];
  readonly locale: MobileShopLocale;
  readonly generatedAt: Temporal.Instant;
  readonly policy: MobileShopCatalogMappingPolicy;
}): MappedMobileShopCatalog => {
  const deniedTags = new Set(
    input.policy.deniedProductTags ?? defaultDeniedProductTags
  );
  const categories = input.categories
    .map((category) => mapCategory(category, input.locale))
    .filter((category) => category !== undefined);
  const categoriesById = new Map(
    categories.map((category) => [category.id, category])
  );
  const stockFulfillmentFacts = new Map<
    DotyposProductId,
    MobileShopStockFulfillmentFact
  >();
  const products: MobileShopCatalogProduct[] = [];

  for (const providerProduct of input.products) {
    const product = mapProduct({
      product: providerProduct,
      categoriesById,
      deniedTags,
      locale: input.locale,
      finalPriceField: input.policy.finalPriceField,
    });
    if (!product) continue;

    products.push(product);
    stockFulfillmentFacts.set(product.id, {
      productId: product.id,
      stockDeductionEnabled: providerProduct.stockDeduct === true,
      role: "backend-informative-only",
    });
  }

  products.sort(compareCatalogProducts(categoriesById));
  const categoryIdsWithProducts = new Set(
    products.map((product) => product.categoryId)
  );
  const displayCategories = categories
    .filter((category) => categoryIdsWithProducts.has(category.id))
    .sort(compareCategories);
  const catalogFacts = {
    categories: displayCategories,
    products,
    taxRegimeVersion: input.policy.taxRegime.version,
    locale: input.locale,
  };

  return {
    catalog: {
      version: hashCanonicalValue(catalogFacts),
      generatedAt: instantStringSchema.make(input.generatedAt.toString()),
      categories: displayCategories,
      products,
    },
    stockFulfillmentFacts,
  };
};

const mapCategory = (
  category: DotyposCategory,
  locale: MobileShopLocale
): MobileShopCatalogCategory | undefined => {
  if (
    !category.id ||
    category.deleted === true ||
    category.display === false ||
    hasExactTag(category.tags, "non-menu")
  ) {
    return undefined;
  }
  const canonicalName = category.name?.trim();
  const name = getTranslatedValue(
    category.translatedName,
    locale,
    canonicalName
  )?.trim();
  if (!name) return undefined;

  const order = parseProviderOrder(category.ordering) ?? 0;
  const color = sanitizeHexColor(category.hexColor);
  return {
    id: category.id,
    name,
    order,
    ...(color && { color }),
  };
};

const mapProduct = (input: {
  readonly product: DotyposProduct;
  readonly categoriesById: ReadonlyMap<
    DotyposProduct["_categoryId"],
    MobileShopCatalogCategory
  >;
  readonly deniedTags: ReadonlySet<string>;
  readonly locale: MobileShopLocale;
  readonly finalPriceField: MobileShopFinalPriceField;
}): MobileShopCatalogProduct | undefined => {
  const { product } = input;
  if (
    !product.id ||
    product.deleted === true ||
    product.display !== true ||
    !input.categoriesById.has(product._categoryId) ||
    !hasExactTag(product.tags, mobileShopCatalogTag) ||
    hasAnyExactTag(product.tags, input.deniedTags)
  ) {
    return undefined;
  }

  const canonicalName = product.name.trim();
  const name = getTranslatedValue(
    product.translatedName,
    input.locale,
    canonicalName
  )?.trim();
  if (!canonicalName || !name) return undefined;

  const providerPrice = product[input.finalPriceField];
  const priceValue = Option.getOrUndefined(
    decodePositiveDotyposPrice(providerPrice)
  );
  if (!Number.isSafeInteger(priceValue) || !priceValue) return undefined;

  const description = getTranslatedValue(
    product.translatedDescription,
    input.locale,
    product.description ?? product.subtitle
  )?.trim();
  const imageUrl = sanitizeImageUrl(product.imageUrl);
  const unitLabel = product.unit?.trim() || product.packaging?.trim();
  const version =
    product.versionDate?.trim() ||
    hashCanonicalValue({
      id: product.id,
      categoryId: product._categoryId,
      canonicalName,
      description: product.description,
      imageUrl,
      unitLabel,
      priceValue,
    });

  return {
    id: product.id,
    categoryId: product._categoryId,
    name,
    canonicalName,
    ...(description && { description }),
    ...(imageUrl && { imageUrl }),
    ...(unitLabel && { unitLabel }),
    price: {
      value: priceValue,
      exponent: czkCurrency.exponent,
      currency: czkCurrency.code,
    },
    version,
  };
};

const toExactTags = (
  tags: readonly string[] | string | null | undefined
): readonly string[] => {
  if (typeof tags === "string") return [tags];
  return tags ?? [];
};

const hasExactTag = (
  tags: readonly string[] | string | null | undefined,
  tag: string
) => toExactTags(tags).includes(tag);

const hasAnyExactTag = (
  tags: readonly string[] | string | null | undefined,
  deniedTags: ReadonlySet<string>
) => toExactTags(tags).some((tag) => deniedTags.has(tag));

const parseProviderOrder = (value: string | null | undefined) => {
  if (!value || !/^-?\d+$/.test(value)) return undefined;
  const order = Number(value);
  return Number.isSafeInteger(order) ? order : undefined;
};

const sanitizeHexColor = (value: string | null | undefined) => {
  const color = value?.trim();
  return color && /^#[\da-f]{6}$/i.test(color) ? color : undefined;
};

const sanitizeImageUrl = (value: string | null | undefined) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const compareCategories = (
  left: MobileShopCatalogCategory,
  right: MobileShopCatalogCategory
) => left.order - right.order || left.id.localeCompare(right.id);

const compareCatalogProducts =
  (
    categoriesById: ReadonlyMap<
      MobileShopCatalogProduct["categoryId"],
      MobileShopCatalogCategory
    >
  ) =>
  (left: MobileShopCatalogProduct, right: MobileShopCatalogProduct) =>
    (categoriesById.get(left.categoryId)?.order ?? 0) -
      (categoriesById.get(right.categoryId)?.order ?? 0) ||
    left.id.localeCompare(right.id);

const hashCanonicalValue = (value: unknown) =>
  Array.from(JSON.stringify(value))
    .reduce(
      (hash, character) =>
        Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0,
      0x811c9dc5
    )
    .toString(16);
