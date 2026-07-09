"use server";

import { Effect } from "effect";
import {
  CheckoutService,
  CheckoutServiceLiveWithDependencies,
  openPayState,
} from "@/features/checkout/backend/checkout";
import { m } from "@/features/i18n";
import {
  getSubmitReservationCheckoutLocale,
  getSubmitReservationSchema,
  type SubmitReservationInput,
} from "@/features/reservation/actions/submit-reservation-input";
import { getReservationAvailabilityUnavailableMessage } from "@/features/reservation/reservation.i18n";
import { getReservationPragueDate } from "@/features/reservation/schemas/reservation-interval";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const getSubmitReservationErrorMessage = (
  error: { readonly message: string },
  input: SubmitReservationInput
) => {
  if (error.message !== "workspace_table_unavailable") {
    return m.reservationErrorMessage({}, { locale: input.locale });
  }

  try {
    const payState = openPayState(input.payStateToken);

    return getReservationAvailabilityUnavailableMessage({
      date: getReservationPragueDate(payState.reservation),
      locale: input.locale,
      reservation: payState.reservation,
    });
  } catch {
    return m.reservationErrorMessage({}, { locale: input.locale });
  }
};

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
              message: getSubmitReservationErrorMessage(error, input),
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
