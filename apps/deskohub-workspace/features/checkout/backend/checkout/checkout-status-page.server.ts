import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import type { IReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import type { ICheckoutStatusService } from "./checkout-status.service";

type CheckoutStatusInput = Parameters<
  ICheckoutStatusService["refreshStatus"]
>[0];

export type CheckoutStatusPageInput = CheckoutStatusInput & {
  readonly accessCookie?: string;
  readonly locale: Locale;
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
  }
);
