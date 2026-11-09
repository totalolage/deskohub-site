import { Schema } from "effect";
import { reservationBillingSelectionSchema } from "./reservation-billing";
import { reservationCustomerSchema } from "./reservation-contact";

/**
 * The reservation page query parameter that carries the sealed contact
 * details a signed-out customer typed before verifying the email.
 */
export const checkoutContactQueryParam = "contact";

/**
 * What a signed-out customer types at the contact-details step, phone read in
 * `defaultPhoneRegion` (the visitor locale's, `defaultPhoneRegion(locale)`).
 * It rides on the sign-in's return path, so the reservation page the sign-in
 * lands on can save the profile and continue the checkout.
 */
export const reservationCheckoutContactSchema = (defaultPhoneRegion: string) =>
  Schema.Struct({
    ...reservationCustomerSchema(defaultPhoneRegion).fields,
    billing: reservationBillingSelectionSchema,
    marketingConsent: Schema.Boolean,
  });

export type ReservationCheckoutContact = ReturnType<
  typeof reservationCheckoutContactSchema
>["Type"];
