import { Context, Layer } from "effect";
import {
  CustomerAccountContactService,
  CustomerAccountReservationOwnership,
  CustomerReservationHistoryService,
} from "@/features/account";
import type { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { CheckoutStatusService } from "@/features/checkout/backend/checkout/checkout-status.service";
import { ReservationAccessService } from "@/features/reservation/backend/reservation-access.service";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { ReviewSandbox } from "@/features/review-accounts";

/**
 * Who may see an order, decided for the account `authentication` reads, as
 * `ReservationAuthorizationService.Live` decides it for the browser session.
 */
const authorizationFor = (
  authentication: Layer.Layer<CustomerAuthentication>
) =>
  ReservationAuthorizationService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAccountReservationOwnership.withAuthentication(authentication),
        WorkspaceReservationRepository.Live,
        ReviewSandbox.Live
      )
    )
  );

type AuthorizationLayerError = Layer.Error<ReturnType<typeof authorizationFor>>;

/**
 * The reservation services' Layers. Those that read the signed-in account
 * are built from the authentication the session middleware read the
 * request through.
 */
export type CustomerReservationServiceLayers = {
  /** The account's Dotypos link, read without claiming one. */
  readonly contacts: (
    authentication: Layer.Layer<CustomerAuthentication>
  ) => Layer.Layer<
    CustomerAccountContactService,
    Layer.Error<typeof CustomerAccountContactService.Live>
  >;
  /** The reservation history, read live as the account page reads it. */
  readonly history: Layer.Layer<
    CustomerReservationHistoryService,
    Layer.Error<typeof CustomerReservationHistoryService.Live>
  >;
  readonly authorization: (
    authentication: Layer.Layer<CustomerAuthentication>
  ) => Layer.Layer<ReservationAuthorizationService, AuthorizationLayerError>;
  /** Order statuses, refreshed as the status page refreshes them. */
  readonly checkoutStatus: Layer.Layer<
    CheckoutStatusService,
    Layer.Error<typeof CheckoutStatusService.Live>
  >;
  /** Door codes, shown to whom `authorization` lets see them. */
  readonly access: (
    authorization: Layer.Layer<
      ReservationAuthorizationService,
      AuthorizationLayerError
    >
  ) => Layer.Layer<
    ReservationAccessService,
    Layer.Error<typeof ReservationAccessService.Live>
  >;
};

/**
 * The reservation Layers each customer API request builds its operation
 * from, inside the request's Workspace request context, as
 * `CustomerAccountLayers` does for the account.
 */
export class CustomerReservationLayers extends Context.Service<
  CustomerReservationLayers,
  CustomerReservationServiceLayers
>()("@deskohub-workspace/customer-api/CustomerReservationLayers") {
  static Live = Layer.succeed(this, {
    contacts: CustomerAccountContactService.withAuthentication,
    history: CustomerReservationHistoryService.Live,
    authorization: authorizationFor,
    checkoutStatus: CheckoutStatusService.Live,
    access: ReservationAccessService.withAuthorization,
  });
}
