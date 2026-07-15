"use server";

import { Effect, Layer } from "effect";
import {
  CheckoutService,
  CheckoutServiceLiveWithDependencies,
  openPayState,
} from "@/features/checkout/backend/checkout";
import { type Locale, m } from "@/features/i18n";
import {
  getSubmitReservationCheckoutLocale,
  getSubmitReservationSchema,
  type SubmitReservationInput,
} from "@/features/reservation/actions/submit-reservation-input";
import { getReservationAvailabilityUnavailableMessage } from "@/features/reservation/reservation.i18n";
import { getReservationDate } from "@/features/reservation/reservation-interval";
import {
  BotDetectedError,
  BotProtectionService,
} from "@/shared/backend/bot-protection/bot-protection.service";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

const getSubmitReservationErrorMessage = (
  error: { readonly message: string },
  input: SubmitReservationInput
) => {
  if (error instanceof BotDetectedError) {
    return m.reservationRateLimitMessage({}, { locale: input.locale });
  }

  if (error.message !== "workspace_table_unavailable") {
    return m.reservationErrorMessage({}, { locale: input.locale });
  }

  try {
    const payState = openPayState(input.payStateToken);

    return getReservationAvailabilityUnavailableMessage({
      date: getReservationDate({
        interval: payState.reservation,
        timeZone: workspaceSiteConstants.location.timeZone,
      }),
      locale: input.locale,
      reservation: payState.reservation,
    });
  } catch {
    return m.reservationErrorMessage({}, { locale: input.locale });
  }
};

export const submitWorkspaceReservationEffect = Effect.fn(
  "submitWorkspaceReservation"
)(
  function* (
    input: SubmitReservationInput,
    context: { readonly locale: Locale }
  ) {
    const locale = getSubmitReservationCheckoutLocale(input, context.locale);
    yield* Effect.annotateLogsScoped({ locale });
    const botProtection = yield* BotProtectionService;
    yield* botProtection.verifyHuman({ verificationFailurePolicy: "allow" });
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
);

const submitReservationAction = createEffectSafeAction(
  getSubmitReservationSchema(),
  submitWorkspaceReservationEffect,
  Layer.merge(CheckoutServiceLiveWithDependencies, BotProtectionService.Live)
);

export const submitReservation: typeof submitReservationAction = async (
  ...args: Parameters<typeof submitReservationAction>
) => {
  "use server";
  return await submitReservationAction(...args);
};
