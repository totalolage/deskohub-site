import { Context, Layer } from "effect";
import { CustomerReservationHistoryService } from "@/features/account";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import type { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { ReservationInvoicePdfService } from "@/features/accounting/backend/reservation-invoice-pdf.service";
import { CheckoutStatusService } from "@/features/checkout/backend/checkout/checkout-status.service";
import { ReservationAccessService } from "@/features/reservation/backend/reservation-access.service";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";

type AuthorizationLayerError = Layer.Error<
  typeof ReservationAuthorizationService.ForProvidedAuthentication
>;

/**
 * The reservation services' Layers. Those that read the signed-in account
 * require the authentication the session middleware read the request
 * through, which the handlers provide.
 */
export type CustomerReservationServiceLayers = {
  /** The account's standing, whose stored link the history peeks. */
  readonly currentAccount: Layer.Layer<
    CurrentCustomerAccount,
    Layer.Error<typeof CurrentCustomerAccount.ForProvidedAuthentication>,
    CustomerAuthentication
  >;
  /** The reservation history, read live as the account page reads it. */
  readonly history: Layer.Layer<
    CustomerReservationHistoryService,
    Layer.Error<typeof CustomerReservationHistoryService.Live>
  >;
  /**
   * Who may see an order, decided for the account the request's
   * authentication reads, as `ReservationAuthorizationService.Live` decides
   * it for the browser session.
   */
  readonly authorization: Layer.Layer<
    ReservationAuthorizationService,
    AuthorizationLayerError,
    CustomerAuthentication
  >;
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
    currentAccount: CurrentCustomerAccount.ForProvidedAuthentication,
    history: CustomerReservationHistoryService.Live,
    authorization: ReservationAuthorizationService.ForProvidedAuthentication,
    checkoutStatus: CheckoutStatusService.Live,
    access: ReservationAccessService.withAuthorization,
    invoice: ReservationInvoicePdfService.withAuthorization,
  });
}
