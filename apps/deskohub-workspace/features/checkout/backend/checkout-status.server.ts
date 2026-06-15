import "server-only";

import { Effect } from "effect";
import {
  type CheckoutStatusReturnOutcome,
  CheckoutStatusService,
  CheckoutStatusServiceLiveWithDependencies,
} from "@/features/checkout/backend/checkout-status.service";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

const runCheckoutStatusService = <A, E>(
  useService: (service: CheckoutStatusService) => Effect.Effect<A, E>
) =>
  Effect.gen(function* () {
    const service = yield* CheckoutStatusService;
    return yield* useService(service);
  }).pipe(
    Effect.provide(CheckoutStatusServiceLiveWithDependencies),
    runWorkspaceEffect
  );

export const getCheckoutStatus = (input: {
  readonly orderId: string;
  readonly returnOutcome: CheckoutStatusReturnOutcome;
}) => runCheckoutStatusService((service) => service.getStatus(input));

export const refreshCheckoutStatus = (input: {
  readonly orderId: string;
  readonly returnOutcome: CheckoutStatusReturnOutcome;
}) => runCheckoutStatusService((service) => service.refreshStatus(input));
