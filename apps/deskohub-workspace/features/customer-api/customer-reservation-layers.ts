import { Context, Layer } from "effect";
import {
  CustomerAccountContactService,
  CustomerReservationHistoryService,
} from "@/features/account";
import type { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { ReservationInvoicePdfService } from "@/features/accounting/backend/reservation-invoice-pdf.service";
import { CheckoutStatusService } from "@/features/checkout/backend/checkout/checkout-status.service";
import { ReservationAccessService } from "@/features/reservation/backend/reservation-access.service";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";

type AuthorizationLayerError = Layer.Error<
  typeof ReservationAuthorizationService.Live
>;

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
  /**
   * Who may see an order, decided for the account `authentication` reads,
   * as `ReservationAuthorizationService.Live` decides it for the browser
   * session.
   */
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
  /** Issued invoices, shown to whom `authorization` lets see them. */
  readonly invoice: (
    authorization: Layer.Layer<
      ReservationAuthorizationService,
      AuthorizationLayerError
    >
  ) => Layer.Layer<
    ReservationInvoicePdfService,
    Layer.Error<typeof ReservationInvoicePdfService.Live>
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
    authorization: ReservationAuthorizationService.withAuthentication,
    checkoutStatus: CheckoutStatusService.Live,
    access: ReservationAccessService.withAuthorization,
    invoice: ReservationInvoicePdfService.withAuthorization,
  });
}
