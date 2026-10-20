import "server-only";

import { makeAuthReturnState } from "@/features/account/backend/auth-return-state";
import { reservationCheckoutContactSchema } from "@/features/reservation/reservation-checkout-contact";

/** The checkout contact details sealed into a sign-in's return path. */
export const checkoutContactReturnState = makeAuthReturnState(
  "checkout-contact",
  reservationCheckoutContactSchema
);
