import { Schema } from "effect";
import {
  checkoutSummaryDiscountSchema,
  checkoutSummaryProductItemBaseSchema,
  checkoutSummaryProductKeyFilter,
} from "@/features/checkout/checkout-summary-product-item";
import { positiveWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import {
  officeAdditionalGuestsSchema,
  workspaceOfficeProductIdentitySchema,
} from "@/features/reservation/office-reservation";

const officeCheckoutSummaryProductItemBaseSchema = Schema.Struct({
  ...checkoutSummaryProductItemBaseSchema.fields,
  product: workspaceOfficeProductIdentitySchema,
  dayCount: Schema.Int.check(Schema.isGreaterThan(0)),
  additionalGuests: officeAdditionalGuestsSchema,
  accessAmount: positiveWorkspaceMoneyCodec,
  seatAmount: positiveWorkspaceMoneyCodec,
});

export const officeCheckoutSummaryProductItemSchema = Schema.Struct({
  ...officeCheckoutSummaryProductItemBaseSchema.fields,
  originalAmount: Schema.optionalKey(Schema.Never),
  discounts: Schema.optionalKey(Schema.Never),
}).check(checkoutSummaryProductKeyFilter);

export const officeCheckoutSummaryDiscountedProductItemSchema = Schema.Struct({
  ...officeCheckoutSummaryProductItemBaseSchema.fields,
  originalAmount: positiveWorkspaceMoneyCodec,
  discounts: Schema.NonEmptyArray(checkoutSummaryDiscountSchema),
}).check(checkoutSummaryProductKeyFilter);
