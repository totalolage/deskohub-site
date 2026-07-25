import { Effect, Option } from "effect";
import { getDiscountCodeEntryEnabled } from "@/features/discounts/discount-code-entry.server";
import { buildCheckoutPayContinuationPath } from "./checkout-pay-url";
import { openPayState } from "./pay-state";
import { PayableReservationService } from "./payable-reservation.service";

export const loadCheckoutPayState = Effect.fn("checkoutPay.loadState")(
  function* (payStateToken: string) {
    const state = yield* openPayState(payStateToken);
    const payableReservations = yield* PayableReservationService;
    const discountCodeEntryEnabled = yield* getDiscountCodeEntryEnabled;
    const freshPayUrl = yield* buildCheckoutPayContinuationPath(state).pipe(
      Effect.when(Effect.succeed(state.changedKeys !== undefined)),
      Effect.map(Option.getOrUndefined)
    );

    yield* payableReservations.requireCurrent({
      orderId: state.orderId,
      checkoutSessionId: state.checkoutSessionId,
    });

    return { state, freshPayUrl, discountCodeEntryEnabled };
  },
  (effect) =>
    effect.pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Checkout pay state could not be loaded", {
          cause,
          reason: "payStateUnavailable",
        }).pipe(Effect.as(undefined))
      )
    )
);
