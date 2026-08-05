import { Effect } from "effect";
import type { ICheckoutStatusService } from "./checkout-status.service";

type CheckoutStatusPageInput = Parameters<
  ICheckoutStatusService["refreshStatus"]
>[0];

export const loadCheckoutStatusPage = Effect.fn("CheckoutStatusPage.load")(
  function* (
    checkoutStatus: ICheckoutStatusService,
    input: CheckoutStatusPageInput
  ) {
    return yield* checkoutStatus.refreshStatus(input).pipe(
      Effect.catch((cause) =>
        Effect.logWarning(
          "Checkout status page refresh failed; reading local status",
          {
            cause,
            orderId: input.orderId,
            returnOutcome: input.returnOutcome,
          }
        ).pipe(Effect.andThen(checkoutStatus.getStatus(input)))
      )
    );
  }
);
