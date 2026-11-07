import { HttpApi, OpenApi } from "effect/unstable/httpapi";
import { CustomerAccountApi } from "./customer-account-api";
import { CustomerBookingApi } from "./customer-booking-api";
import { CustomerReservationsApi } from "./customer-reservations-api";
import {
  CustomerRequestOriginCheck,
  CustomerSessionAuthentication,
  customerApiClientHeader,
} from "./customer-session";

/** Every customer API path starts with this. */
export const customerApiPathPrefix = "/api/customer";

/**
 * The signed-in customer's HTTP API, served by the Workspace for the mobile
 * app and other first-party clients. The Better Auth session cookie
 * authenticates every request.
 *
 * Add every group before `.prefix()` and `.middleware()`: each applies only
 * to the groups already added. The last middleware added runs first, so the
 * origin check refuses a cross-site request before any session lookup.
 */
export const WorkspaceCustomerApi = HttpApi.make("workspaceCustomerApi")
  .add(CustomerAccountApi)
  .add(CustomerReservationsApi)
  .add(CustomerBookingApi)
  .prefix(customerApiPathPrefix)
  .middleware(CustomerSessionAuthentication)
  .middleware(CustomerRequestOriginCheck)
  .annotate(OpenApi.Title, "Deskohub Workspace customer API")
  .annotate(
    OpenApi.Description,
    `Authenticated by the Better Auth session cookie that /api/auth sets. Every request carries the ${customerApiClientHeader.name}: ${customerApiClientHeader.value} header; a request without it, or from another site, gets 403.`
  );
