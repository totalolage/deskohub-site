import { Schema } from "effect";
import {
  nonNegativeWorkspaceMoneyCodec,
  positiveWorkspaceMoneyCodec,
} from "@/features/checkout/workspace-money";
import {
  appliedDiscountCodec,
  canonicalPromotionCodeSchema,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { locales } from "@/features/i18n";
import { urlStringSchema } from "@/shared/utils/url-schema";
import { goodsCartQuantitySchema, goodsCartRevisionSchema } from "./goods-cart";
import { workspaceGoodsProductIdentitySchema } from "./goods-product";

export const goodsQuoteRequestSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  submittedCode: Schema.optionalKey(canonicalPromotionCodeSchema),
});

export type GoodsQuoteRequest = typeof goodsQuoteRequestSchema.Type;

export const goodsQuoteLegalDocumentSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  url: urlStringSchema,
  title: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
  hash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  hashAlgorithm: Schema.Literal("sha256"),
});

export type GoodsQuoteLegalDocument = typeof goodsQuoteLegalDocumentSchema.Type;

export const goodsQuoteLineSchema = Schema.Struct({
  product: workspaceGoodsProductIdentitySchema,
  name: Schema.NonEmptyString,
  quantity: goodsCartQuantitySchema,
  unitPrice: positiveWorkspaceMoneyCodec,
  undiscountedSubtotal: positiveWorkspaceMoneyCodec,
  discounts: Schema.Array(appliedDiscountCodec),
  totalDiscount: nonNegativeWorkspaceMoneyCodec,
  total: nonNegativeWorkspaceMoneyCodec,
});

export type GoodsQuoteLine = typeof goodsQuoteLineSchema.Type;

export const goodsQuoteSchema = Schema.Struct({
  locale: goodsQuoteRequestSchema.fields.locale,
  submittedCode: Schema.optionalKey(canonicalPromotionCodeSchema),
  cartRevision: goodsCartRevisionSchema,
  lines: Schema.Array(goodsQuoteLineSchema).check(Schema.isMinLength(1)),
  discountIds: Schema.Array(discountIdSchema),
  undiscountedTotal: positiveWorkspaceMoneyCodec,
  totalDiscount: nonNegativeWorkspaceMoneyCodec,
  total: nonNegativeWorkspaceMoneyCodec,
  legalDocuments: Schema.Struct({
    termsAndConditions: goodsQuoteLegalDocumentSchema,
    operatingRules: goodsQuoteLegalDocumentSchema,
  }),
  fingerprint: Schema.NonEmptyString,
});

export type GoodsQuote = typeof goodsQuoteSchema.Type;

export const goodsQuoteResponseSchema = Schema.Struct({
  quote: goodsQuoteSchema,
  quoteToken: Schema.NonEmptyString,
});

export type GoodsQuoteResponse = typeof goodsQuoteResponseSchema.Type;
