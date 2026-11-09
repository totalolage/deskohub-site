import { Effect, Layer } from "effect";
import {
  type IReservationAuthorizationService,
  ReservationAuthorizationService,
} from "@/features/reservation/backend/reservation-authorization.service";
import { withWorkspaceRequestContext } from "@/shared/backend/workspace-request-context";
import {
  type AuthorizedCheckoutStatusInput,
  loadAuthorizedCheckoutStatus,
} from "./authorized-checkout-status";
import {
  CheckoutStatusService,
  type ICheckoutStatusService,
} from "./checkout-status.service";

export type CheckoutStatusPageInput = AuthorizedCheckoutStatusInput & {
  /**
   * The page request's headers. A refresh can finalize a payment, and its
   * lifecycle events carry this request's agent traffic.
   */
  readonly requestHeaders: Headers;
};

/**
 * The status page's order status (`loadAuthorizedCheckoutStatus`), read in
 * the page request's Workspace request context.
 */
export const loadCheckoutStatusPage = Effect.fn("CheckoutStatusPage.load")(
  function* (
    checkoutStatus: ICheckoutStatusService,
    authorization: IReservationAuthorizationService,
    { requestHeaders, ...input }: CheckoutStatusPageInput
  ) {
    return yield* loadAuthorizedCheckoutStatus(input).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(CheckoutStatusService, checkoutStatus),
          Layer.succeed(ReservationAuthorizationService, authorization)
        )
      ),
      withWorkspaceRequestContext(requestHeaders)
    );
  }
);
