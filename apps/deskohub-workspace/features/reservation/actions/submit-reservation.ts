"use server";

import { Effect } from "effect";
import {
  CheckoutService,
  CheckoutServiceLiveWithDependencies,
} from "@/features/checkout/backend/checkout.service";
import { m } from "@/features/i18n";
import { getReservationSchema } from "@/features/reservation/schemas/reservation";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const submitReservationAction = createEffectSafeAction(
  getReservationSchema(),
  Effect.fn("submitWorkspaceReservation")(
    function* (input, { locale }) {
      const service = yield* CheckoutService;
      const checkout = yield* service.createHostedPaymentCheckout(
        input,
        locale
      );

      yield* Effect.logInfo("Workspace checkout started", {
        locale,
        entryTier: input.entryTier,
      });

      return {
        message: "Checkout started successfully",
        redirectUrl: checkout.redirectUrl,
      };
    },
    (effect, input, { locale }) =>
      effect.pipe(
        Effect.annotateLogs({
          locale,
          entryTier: input.entryTier,
        }),
        Effect.mapError(
          () =>
            new PublicSafeActionError(m.reservationErrorMessage({}, { locale }))
        )
      )
  ),
  CheckoutServiceLiveWithDependencies
);

export const submitReservation: typeof submitReservationAction = async (
  ...args: Parameters<typeof submitReservationAction>
) => {
  "use server";
  return await submitReservationAction(...args);
};
