import "server-only";

import { WorkspaceCustomerApi } from "@deskohub/workspace-customer-api";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { handleCustomerBookingCatalog } from "./customer-booking-catalog-handlers";
import { handleCustomerBookingCheckout } from "./customer-booking-checkout-handlers";

/**
 * The booking group's handlers: the catalog a booking reads first, then
 * checkout. Each module attaches its own endpoints' handlers.
 */
export const CustomerBookingApiHandlers = HttpApiBuilder.group(
  WorkspaceCustomerApi,
  "booking",
  (handlers) =>
    handleCustomerBookingCheckout(handlers).pipe(
      Effect.flatMap(handleCustomerBookingCatalog)
    )
);
