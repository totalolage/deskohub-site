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

/**
 * Checkout details for log annotations: the reservation kind and how many
 * discounts the price includes. The details themselves, with the reservation
 * projection, price summary and legal evidence, stay off every row the
 * annotation reaches.
 */
export const checkoutDetailsLogFields = (details: CheckoutDetails) => ({
  reservationKind: details.reservation.kind,
  discountCount: details.payment.discounts.length,
});
