import { HttpApiGroup } from "effect/unstable/httpapi";
import { customerBookingCatalogEndpoints } from "./customer-booking-catalog-api";
import { customerBookingCheckoutEndpoints } from "./customer-booking-checkout-api";

/**
 * Booking a space as the signed-in customer: what it reads before checkout,
 * then checkout itself. Add endpoints before `.prefix()`.
 */
export const CustomerBookingApi = HttpApiGroup.make("booking")
  .add(...customerBookingCatalogEndpoints)
  .add(...customerBookingCheckoutEndpoints)
  .prefix("/booking");
