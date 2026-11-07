import "server-only";

import { WorkspaceCustomerApi } from "@deskohub/workspace-customer-api";
import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { CustomerRequestOrigins } from "@/features/account/backend/auth/customer-request-origins.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { RequestBudget } from "@/shared/backend/request-budget/request-budget.service";
import { toWorkspaceWebHandler } from "@/shared/backend/workspace-effect";
import {
  continueMutationsAfterDisconnect,
  privateNoStoreResponses,
} from "@/shared/backend/workspace-http-api-route";
import { WorkspaceRouterRequestContext } from "@/shared/backend/workspace-router-request-context";
import { CustomerAccountApiHandlers } from "./customer-account-handlers";
import { CustomerAccountLayers } from "./customer-account-layers";
import { CustomerBookingCatalogLayers } from "./customer-booking-catalog-layers";
import { CustomerBookingCheckoutLayers } from "./customer-booking-checkout-layers";
import { CustomerBookingApiHandlers } from "./customer-booking-handlers";
import {
  CustomerRequestOriginCheckLive,
  CustomerSessionAuthenticationLive,
} from "./customer-request-checks";
import { CustomerReservationsApiHandlers } from "./customer-reservation-handlers";
import { CustomerReservationLayers } from "./customer-reservation-layers";

/**
 * The customer API's HTTP app: every group's handlers behind the origin
 * check and session authentication, each routed request served in its own
 * Workspace request context, and every response private and uncached. Each
 * call builds its own router, group handlers and global middleware, which
 * capture the router they were built with, so instances sharing the
 * Workspace memo map must not share them. The account, reservation and
 * booking services, the request origins, the authentication and the
 * request budget come from the caller.
 */
export const makeWorkspaceCustomerApiLayer = () =>
  Layer.mergeAll(
    HttpApiBuilder.layer(WorkspaceCustomerApi).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.fresh(CustomerAccountApiHandlers),
          Layer.fresh(CustomerReservationsApiHandlers),
          Layer.fresh(CustomerBookingApiHandlers)
        )
      ),
      Layer.provide(
        Layer.mergeAll(
          CustomerRequestOriginCheckLive,
          CustomerSessionAuthenticationLive
        )
      )
    ),
    Layer.fresh(WorkspaceRouterRequestContext),
    Layer.fresh(privateNoStoreResponses)
  ).pipe(
    // Overrides the router `HttpRouter.toWebHandler` provides, which the
    // memo map would share between instances.
    Layer.provideMerge(Layer.fresh(HttpRouter.layer))
  );

/** The Workspace services behind the customer API. */
const provideWorkspaceCustomerApiServices = <A, E, R>(
  layer: Layer.Layer<A, E, R>
) =>
  layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAccountLayers.Live,
        CustomerReservationLayers.Live,
        CustomerBookingCatalogLayers.Live,
        CustomerBookingCheckoutLayers.Live,
        CustomerAuthentication.Default,
        CustomerRequestOrigins.Default,
        RequestBudget.Live
      )
    )
  );

/**
 * Serves a customer API request. A mutation runs to completion after its
 * client disconnects; a GET stops with it.
 */
export const handleWorkspaceCustomerApiRequest =
  continueMutationsAfterDisconnect(
    toWorkspaceWebHandler(
      provideWorkspaceCustomerApiServices(makeWorkspaceCustomerApiLayer())
    )
  );
