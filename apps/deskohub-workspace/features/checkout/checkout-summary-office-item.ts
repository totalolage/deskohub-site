import { Schema } from "effect";
import {
  checkoutSummaryDiscountSchema,
  checkoutSummaryProductItemBaseSchema,
  checkoutSummaryProductKeyFilter,
} from "@/features/checkout/checkout-summary-product-item";
import { positiveWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import {
  officeReservationDayCountSchema,
  officeSeatsSchema,
  workspaceOfficeProductIdentitySchema,
} from "@/features/reservation/office-reservation";

const officeCheckoutSummaryProductItemBaseSchema = Schema.Struct({
  ...checkoutSummaryProductItemBaseSchema.fields,
  product: workspaceOfficeProductIdentitySchema,
  dayCount: officeReservationDayCountSchema,
  seats: officeSeatsSchema,
  accessAmount: positiveWorkspaceMoneyCodec,
  seatAmount: positiveWorkspaceMoneyCodec,
});

const officeProductDetailsFilter = Schema.makeFilter(
  (item: typeof officeCheckoutSummaryProductItemBaseSchema.Type) =>
    (item.product.seats === item.seats &&
      item.product.dayCount === item.dayCount) || {
      path: ["product"],
      issue: "office product identity must match its seat and day counts",
    }
);

export const officeCheckoutSummaryProductItemSchema = Schema.Struct({
  ...officeCheckoutSummaryProductItemBaseSchema.fields,
  originalAmount: Schema.optionalKey(Schema.Never),
  discounts: Schema.optionalKey(Schema.Never),
}).check(checkoutSummaryProductKeyFilter, officeProductDetailsFilter);

export const officeCheckoutSummaryDiscountedProductItemSchema = Schema.Struct({
  ...officeCheckoutSummaryProductItemBaseSchema.fields,
  originalAmount: positiveWorkspaceMoneyCodec,
  discounts: Schema.NonEmptyArray(checkoutSummaryDiscountSchema),
}).check(checkoutSummaryProductKeyFilter, officeProductDetailsFilter);
