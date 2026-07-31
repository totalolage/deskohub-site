import { Schema } from "effect";
import {
  checkoutSummaryDiscountSchema,
  checkoutSummaryProductItemBaseSchema,
  checkoutSummaryProductKeyFilter,
} from "@/features/checkout/checkout-summary-product-item";
import { positiveWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import { workspaceMeetingRoomProductIdentitySchema } from "@/features/reservation/meeting-room-reservation";

const meetingRoomCheckoutSummaryProductItemBaseSchema = Schema.Struct({
  ...checkoutSummaryProductItemBaseSchema.fields,
  product: workspaceMeetingRoomProductIdentitySchema,
});

export const meetingRoomCheckoutSummaryProductItemSchema = Schema.Struct({
  ...meetingRoomCheckoutSummaryProductItemBaseSchema.fields,
  originalAmount: Schema.optionalKey(Schema.Never),
  discounts: Schema.optionalKey(Schema.Never),
}).check(checkoutSummaryProductKeyFilter);

export const meetingRoomCheckoutSummaryDiscountedProductItemSchema =
  Schema.Struct({
    ...meetingRoomCheckoutSummaryProductItemBaseSchema.fields,
    originalAmount: positiveWorkspaceMoneyCodec,
    discounts: Schema.NonEmptyArray(checkoutSummaryDiscountSchema),
  }).check(checkoutSummaryProductKeyFilter);
