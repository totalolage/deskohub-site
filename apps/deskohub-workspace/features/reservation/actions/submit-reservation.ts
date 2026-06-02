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
      const service = yield* CheckoutService;
      const checkout = yield* service.createHostedPaymentCheckout(
        {
          payStateToken: input.payStateToken,
          legalConsent: input.legalConsent,
        },
        locale
      );

      yield* Effect.logInfo("Workspace checkout started");

      return {
        message: "Checkout started successfully",
        ...checkout,
      };
    },
    (effect, input) =>
      effect.pipe(
        Effect.scoped,
        Effect.annotateLogs(input),
        Effect.mapError(
          (error) =>
            new PublicSafeActionError({
              message:
                error.message === "workspace_table_unavailable"
                  ? m.reservationAvailabilityUnavailable(
                      {},
                      { locale: input.locale }
                    )
                  : m.reservationErrorMessage({}, { locale: input.locale }),
              cause: error,
            })
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
