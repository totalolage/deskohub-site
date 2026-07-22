import "server-only";

import { Effect } from "effect";
import {
  type CheckoutStatusReturnOutcome,
  CheckoutStatusService,
} from "./checkout-status.service";

export const getCheckoutStatus = Effect.fn("checkoutStatus.get")(
  function* (input: {
    readonly orderId: string;
    readonly returnOutcome: CheckoutStatusReturnOutcome;
  }) {
    const service = yield* CheckoutStatusService;
    return yield* service.getStatus(input);
  }
);

export const refreshCheckoutStatus = Effect.fn("checkoutStatus.refresh")(
  function* (input: {
    readonly orderId: string;
    readonly returnOutcome: CheckoutStatusReturnOutcome;
  }) {
    const service = yield* CheckoutStatusService;
    return yield* service.refreshStatus(input);
  }
);
