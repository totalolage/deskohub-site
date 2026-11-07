import { HttpApiGroup } from "effect/unstable/httpapi";

/**
 * Booking a space as the signed-in customer. Endpoints arrive with #985; add
 * them before `.prefix()`.
 */
export const CustomerBookingApi =
  HttpApiGroup.make("booking").prefix("/booking");
