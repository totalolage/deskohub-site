import { Option, Schema } from "effect";
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

const decodeWorkspaceProductKey = Schema.decodeUnknownOption(
  workspaceProductKeySchema
);
const checkoutSummaryProductItemKeySchema = Schema.String.check(
  Schema.makeFilter((key) => {
    if (!key.startsWith("product:")) return false;
    return Option.isSome(
      decodeWorkspaceProductKey(key.slice("product:".length))
    );
  })
);

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
