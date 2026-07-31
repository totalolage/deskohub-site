import { Schema } from "effect";
import {
  getWorkspaceProductKey,
  workspaceProductIdentitySchema,
  workspaceProductKeySchema,
} from "@/features/checkout/product-identity";
import { nonNegativeWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import type { AppliedDiscount } from "@/features/discounts/contracts";
import { appliedDiscountCodec } from "@/features/discounts/contracts";

export type CheckoutSummaryDiscount = Pick<
  AppliedDiscount,
  "discount" | "amount"
>;

export const checkoutSummaryDiscountSchema: Schema.Codec<
  CheckoutSummaryDiscount,
  Pick<typeof appliedDiscountCodec.Encoded, "discount" | "amount">
> = Schema.Struct({
  discount: appliedDiscountCodec.fields.discount,
  amount: appliedDiscountCodec.fields.amount,
});

const checkoutSummaryProductItemKeySchema = Schema.TemplateLiteral([
  "product:",
  workspaceProductKeySchema,
]);

export const checkoutSummaryProductItemBaseSchema = Schema.Struct({
  key: checkoutSummaryProductItemKeySchema,
  product: workspaceProductIdentitySchema,
  amount: nonNegativeWorkspaceMoneyCodec,
});

export const checkoutSummaryProductKeyFilter = Schema.makeFilter(
  ({ key, product }: typeof checkoutSummaryProductItemBaseSchema.Type) =>
    key === `product:${getWorkspaceProductKey(product)}` || {
      path: ["key"],
      issue: "product summary key must match the product identity",
    }
);
