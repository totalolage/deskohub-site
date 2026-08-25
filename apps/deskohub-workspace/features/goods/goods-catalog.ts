import { DotyposCategoryIdSchema } from "@deskohub/dotypos";
import { Schema } from "effect";
import { positiveWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import { urlStringSchema } from "@/shared/utils/url-schema";
import { workspaceGoodsProductIdentitySchema } from "./goods-product";

export const goodsCatalogProductSchema = Schema.Struct({
  identity: workspaceGoodsProductIdentitySchema,
  name: Schema.Trim.check(Schema.isNonEmpty()),
  description: Schema.optionalKey(Schema.Trim.check(Schema.isNonEmpty())),
  imageUrl: Schema.optionalKey(urlStringSchema),
  unit: Schema.optionalKey(Schema.Trim.check(Schema.isNonEmpty())),
  unitPrice: positiveWorkspaceMoneyCodec,
});

export type GoodsCatalogProduct = typeof goodsCatalogProductSchema.Type;

export const goodsCatalogCategorySchema = Schema.Struct({
  categoryId: DotyposCategoryIdSchema,
  name: Schema.Trim.check(Schema.isNonEmpty()),
  products: Schema.Array(goodsCatalogProductSchema),
});

export type GoodsCatalogCategory = typeof goodsCatalogCategorySchema.Type;

export const goodsCatalogSchema = Schema.Struct({
  categories: Schema.Array(goodsCatalogCategorySchema),
});

export type GoodsCatalog = typeof goodsCatalogSchema.Type;
