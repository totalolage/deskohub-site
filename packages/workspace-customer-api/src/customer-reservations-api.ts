import { HttpApiGroup } from "effect/unstable/httpapi";

/**
 * The signed-in customer's reservations: history and status. Endpoints
 * arrive with #984; add them before `.prefix()`.
 */
export const CustomerReservationsApi =
  HttpApiGroup.make("reservations").prefix("/reservations");
