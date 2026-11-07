import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import {
  CheckoutStatusService,
  type ICheckoutStatusService,
} from "./checkout-status.service";

type CheckoutStatusInput = Parameters<
  ICheckoutStatusService["refreshStatus"]
>[0];

export type AuthorizedCheckoutStatusInput = CheckoutStatusInput & {
  readonly accessCookie?: string;
  /** The locale an emailed capability link was issued for. */
  readonly locale: Locale;
};

/**
 * The status of an order the visitor may see, as its status page shows it:
 * refreshed, which can finalize a payment, or the local status when the
 * refresh fails. An order the visitor may not see is `not_found`, and its
 * status isn't read.
 */
export const loadAuthorizedCheckoutStatus = Effect.fn(
  "CheckoutStatus.loadAuthorized"
)(function* (input: AuthorizedCheckoutStatusInput) {
  const authorization = yield* ReservationAuthorizationService;
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

  const checkoutStatus = yield* CheckoutStatusService;
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
});
