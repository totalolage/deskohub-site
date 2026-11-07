import { HttpApiGroup } from "effect/unstable/httpapi";
import { customerBookingCatalogEndpoints } from "./customer-booking-catalog-api";

/**
 * Booking a space as the signed-in customer: what it reads before checkout,
 * then checkout itself. Add endpoints before `.prefix()`.
 */
export const CustomerBookingApi = HttpApiGroup.make("booking")
  .add(...customerBookingCatalogEndpoints)
  .prefix("/booking");
