import { Schema } from "effect";
import { coworkCheckoutDetailsSchema } from "@/features/checkout/schemas/checkout-details-cowork";
import { meetingRoomCheckoutDetailsSchema } from "@/features/checkout/schemas/checkout-details-meeting-room";
import { officeCheckoutDetailsSchema } from "@/features/checkout/schemas/checkout-details-office";

export const checkoutDetailsSchema = Schema.Union([
  coworkCheckoutDetailsSchema,
  meetingRoomCheckoutDetailsSchema,
  officeCheckoutDetailsSchema,
]).annotate({
  identifier: "CheckoutDetails",
  description: "Transient PII-free checkout provider snapshot.",
});

export type CheckoutDetails = typeof checkoutDetailsSchema.Type;
