import { Schema } from "effect";
import {
  checkoutSummaryDiscountSchema,
  checkoutSummaryProductItemBaseSchema,
  checkoutSummaryProductKeyFilter,
} from "@/features/checkout/checkout-summary-product-item";
import { positiveWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import { workspaceCoworkProductIdentitySchema } from "@/features/reservation/cowork-reservation-product";

const coworkCheckoutSummaryProductItemBaseSchema = Schema.Struct({
  ...checkoutSummaryProductItemBaseSchema.fields,
  product: workspaceCoworkProductIdentitySchema,
});

export const coworkCheckoutSummaryProductItemSchema = Schema.Struct({
  ...coworkCheckoutSummaryProductItemBaseSchema.fields,
  originalAmount: Schema.optionalKey(Schema.Never),
  discounts: Schema.optionalKey(Schema.Never),
}).check(checkoutSummaryProductKeyFilter);

export const coworkCheckoutSummaryDiscountedProductItemSchema = Schema.Struct({
  ...coworkCheckoutSummaryProductItemBaseSchema.fields,
  originalAmount: positiveWorkspaceMoneyCodec,
  discounts: Schema.NonEmptyArray(checkoutSummaryDiscountSchema),
}).check(checkoutSummaryProductKeyFilter);
