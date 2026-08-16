import { Schema } from "effect";
import {
  legalDocumentHashSchema,
  legalDocumentKeys,
} from "@/features/checkout/legal-evidence";
import {
  nonNegativeWorkspaceMoneyCodec,
  type WorkspaceMoney,
} from "@/features/checkout/workspace-money";
import { locales } from "@/features/i18n";
import {
  orderFulfillmentStates,
  orderIdSchema,
  orderPaymentStates,
} from "@/features/order";
import { instantStringSchema } from "@/shared/utils/temporal";
import { goodsCartQuantitySchema, goodsCartSchema } from "./goods-cart";
import { workspaceGoodsProductIdentitySchema } from "./goods-product";

export const goodsOrderIssuanceIdSchema = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  )
)
  .pipe(Schema.brand("GoodsOrderIssuanceId"))
  .annotate({
    identifier: "GoodsOrderIssuanceId",
    description: "Stable UUID used to idempotently issue one goods order.",
  });

export type GoodsOrderIssuanceId = typeof goodsOrderIssuanceIdSchema.Type;

export const issueGoodsOrderRequestSchema = Schema.Struct({
  issuanceId: goodsOrderIssuanceIdSchema,
  quoteToken: Schema.NonEmptyString,
  acknowledged: Schema.Literal(true),
});

export type IssueGoodsOrderRequest = typeof issueGoodsOrderRequestSchema.Type;

const goodsOrderMoneySchema = nonNegativeWorkspaceMoneyCodec.check(
  Schema.makeFilter((money) => money.value <= 2_147_483_647, {
    message: "Goods order money must fit the PostgreSQL integer boundary.",
  })
);

export const goodsOrderLineSchema = Schema.Struct({
  product: workspaceGoodsProductIdentitySchema,
  description: Schema.Trim.check(Schema.isNonEmpty()),
  quantity: goodsCartQuantitySchema,
  unitPrice: goodsOrderMoneySchema,
  undiscountedTotal: goodsOrderMoneySchema,
  payableTotal: goodsOrderMoneySchema,
}).check(
  Schema.makeFilter(
    (line) => {
      const sameUnit = (money: WorkspaceMoney) =>
        money.currency === line.unitPrice.currency &&
        money.exponent === line.unitPrice.exponent;
      return (
        sameUnit(line.undiscountedTotal) &&
        sameUnit(line.payableTotal) &&
        line.undiscountedTotal.value === line.unitPrice.value * line.quantity &&
        line.payableTotal.value <= line.undiscountedTotal.value
      );
    },
    { message: "Goods order line money must reconcile exactly." }
  )
);

export type GoodsOrderLine = typeof goodsOrderLineSchema.Type;

export const goodsOrderLegalDocumentSchema = Schema.Struct({
  documentKey: Schema.Literals(legalDocumentKeys),
  document: legalDocumentHashSchema,
  acknowledgements: Schema.optionalKey(
    Schema.Record(Schema.NonEmptyString, Schema.Boolean)
  ),
});

export type GoodsOrderLegalDocument = typeof goodsOrderLegalDocumentSchema.Type;

export const goodsOrderIssuanceFactsSchema = Schema.Struct({
  issuanceId: goodsOrderIssuanceIdSchema,
  expectedCart: goodsCartSchema,
  lines: Schema.NonEmptyArray(goodsOrderLineSchema),
  locale: Schema.Literals(locales),
  legalDocuments: Schema.NonEmptyArray(goodsOrderLegalDocumentSchema),
}).check(
  Schema.makeFilter(
    (facts) => {
      const cartItems = new Map(
        facts.expectedCart.items.map(({ productId, quantity }) => [
          productId,
          quantity,
        ])
      );
      const lineItems = new Map(
        facts.lines.map(({ product, quantity }) => [
          product.productId,
          quantity,
        ])
      );
      const firstLine = facts.lines[0];
      return (
        facts.expectedCart.items.length > 0 &&
        cartItems.size === facts.expectedCart.items.length &&
        lineItems.size === facts.lines.length &&
        cartItems.size === lineItems.size &&
        [...cartItems].every(
          ([productId, quantity]) => lineItems.get(productId) === quantity
        ) &&
        facts.lines.every(
          ({ unitPrice }) =>
            unitPrice.currency === firstLine.unitPrice.currency &&
            unitPrice.exponent === firstLine.unitPrice.exponent
        ) &&
        new Set(facts.legalDocuments.map(({ documentKey }) => documentKey))
          .size === facts.legalDocuments.length &&
        new Set(facts.legalDocuments.map(({ document }) => document.hash))
          .size === facts.legalDocuments.length
      );
    },
    { message: "Goods issuance facts must describe one exact non-empty cart." }
  )
);

export type GoodsOrderIssuanceFacts = typeof goodsOrderIssuanceFactsSchema.Type;

const goodsOrderStateSchema = Schema.Struct({
  id: orderIdSchema,
  paymentState: Schema.Literals(orderPaymentStates),
  fulfillmentState: Schema.Literals(orderFulfillmentStates),
  fulfilledAt: instantStringSchema,
  createdAt: instantStringSchema,
  undiscountedTotal: nonNegativeWorkspaceMoneyCodec,
  payableTotal: nonNegativeWorkspaceMoneyCodec,
});

export const goodsOrderSummarySchema = goodsOrderStateSchema;

export type GoodsOrderSummary = typeof goodsOrderSummarySchema.Type;

export const goodsOrderDetailSchema = Schema.Struct({
  ...goodsOrderStateSchema.fields,
  lines: Schema.NonEmptyArray(goodsOrderLineSchema),
});

export type GoodsOrderDetail = typeof goodsOrderDetailSchema.Type;

export const goodsOrderIssueLegalEvidenceSource = "goods_order_issue";
