import { Schema } from "effect";
import { reservationBillingSelectionSchema } from "./reservation-billing";
import { reservationCustomerSchema } from "./reservation-contact";

/**
 * The reservation page query parameter that carries the sealed contact
 * details a signed-out customer typed before verifying the email.
 */
export const checkoutContactQueryParam = "contact";

/**
 * What a signed-out customer types at the contact-details step. It rides on
 * the sign-in's return path, so the reservation page the sign-in lands on can
 * save the profile and continue the checkout.
 */
export const reservationCheckoutContactSchema = Schema.Struct({
  ...reservationCustomerSchema.fields,
  billing: reservationBillingSelectionSchema,
  marketingConsent: Schema.Boolean,
});

export type ReservationCheckoutContact =
  typeof reservationCheckoutContactSchema.Type;
