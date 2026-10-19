import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import type { IReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import { withWorkspaceRequestContext } from "@/shared/backend/workspace-request-context";
import type { ICheckoutStatusService } from "./checkout-status.service";

type CheckoutStatusInput = Parameters<
  ICheckoutStatusService["refreshStatus"]
>[0];

export type CheckoutStatusPageInput = CheckoutStatusInput & {
  readonly accessCookie?: string;
  readonly locale: Locale;
  /**
   * The page request's headers. A refresh can finalize a payment, and its
   * lifecycle events carry this request's agent traffic.
   */
  readonly requestHeaders: Headers;
};

export const loadCheckoutStatusPage = Effect.fn("CheckoutStatusPage.load")(
  function* (
    checkoutStatus: ICheckoutStatusService,
    authorization: IReservationAuthorizationService,
    input: CheckoutStatusPageInput
  ) {
    const authorized = yield* authorization.isAuthorized({
      accessCookie: input.accessCookie,
      locale: input.locale,
      orderId: input.orderId,
      permission: "view-status",
    });
    if (!authorized) {
      return {
        orderId: input.orderId,
        returnOutcome: input.returnOutcome,
        status: "not_found",
      } as const;
    }

    const statusInput: CheckoutStatusInput = {
      orderId: input.orderId,
      returnOutcome: input.returnOutcome,
    };
    return yield* checkoutStatus.refreshStatus(statusInput).pipe(
      Effect.catch((cause) =>
        Effect.logWarning(
          "Checkout status page refresh failed; reading local status",
          {
            cause,
            orderId: statusInput.orderId,
            returnOutcome: statusInput.returnOutcome,
          }
        ).pipe(Effect.andThen(checkoutStatus.getStatus(statusInput)))
      )
    );
  },
  (effect, _checkoutStatus, _authorization, input) =>
    effect.pipe(withWorkspaceRequestContext(input.requestHeaders))
);
