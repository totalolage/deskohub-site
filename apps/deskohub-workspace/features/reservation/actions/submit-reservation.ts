"use server";

import { Effect } from "effect";
import {
  CheckoutService,
  CheckoutServiceLiveWithDependencies,
} from "@/features/checkout/backend/checkout.service";
import { m } from "@/features/i18n";
import {
  getSubmitReservationCheckoutLocale,
  getSubmitReservationSchema,
} from "@/features/reservation/actions/submit-reservation-input";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const submitReservationAction = createEffectSafeAction(
  getSubmitReservationSchema(),
  Effect.fn("submitWorkspaceReservation")(
    function* (input, context) {
      const locale = getSubmitReservationCheckoutLocale(input, context.locale);
      yield* Effect.annotateLogsScoped({ locale });
      const { reservation } = input;
      const service = yield* CheckoutService;
      const checkout = yield* service.createHostedPaymentCheckout(
        reservation,
        locale
      );

      yield* Effect.logInfo("Workspace checkout started");

      return {
        message: "Checkout started successfully",
        redirectUrl: checkout.redirectUrl,
      };
    },
    (effect, input) =>
      effect.pipe(
        Effect.scoped,
        Effect.annotateLogs(input),
        Effect.mapError(
          () =>
            new PublicSafeActionError(
              m.reservationErrorMessage({}, { locale: input.locale })
            )
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
