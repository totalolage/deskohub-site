import "server-only";

import { Effect } from "effect";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  type CheckoutStatusReturnOutcome,
  CheckoutStatusService,
  CheckoutStatusServiceLiveWithDependencies,
} from "./checkout-status.service";

const runCheckoutStatusService = <A, E>(
  operation: string,
  useService: (service: CheckoutStatusService) => Effect.Effect<A, E>
) =>
  WorkspaceEffect.run(
    { operation, layer: CheckoutStatusServiceLiveWithDependencies },
    Effect.gen(function* () {
      const service = yield* CheckoutStatusService;
      return yield* useService(service);
    })
  );

export const getCheckoutStatus = (input: {
  readonly orderId: string;
  readonly returnOutcome: CheckoutStatusReturnOutcome;
}) =>
  runCheckoutStatusService("checkout.status.get", (service) =>
    service.getStatus(input)
  );

export const refreshCheckoutStatus = (input: {
  readonly orderId: string;
  readonly returnOutcome: CheckoutStatusReturnOutcome;
}) =>
  runCheckoutStatusService("checkout.status.refresh", (service) =>
    service.refreshStatus(input)
  );
