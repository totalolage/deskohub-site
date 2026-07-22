import { Effect } from "effect";
import {
  CheckoutError,
  CheckoutService,
} from "@/features/checkout/backend/checkout";
import { m } from "@/features/i18n";
import type { SubmitReservationInput } from "@/features/reservation/actions/submit-reservation-input";
import { WorkspaceTableUnavailableError } from "@/features/reservation/backend/workspace-availability.service";
import { getReservationAvailabilityUnavailableMessage } from "@/features/reservation/reservation.i18n";
import {
  BotDetectedError,
  BotProtectionService,
} from "@/shared/backend/bot-protection/bot-protection.service";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const getSubmitReservationErrorMessage = (
  error: { readonly message: string },
  input: SubmitReservationInput
) => {
  if (error instanceof BotDetectedError) {
    return m.reservationRateLimitMessage({}, { locale: input.locale });
  }

  const unavailableCause =
    error instanceof CheckoutError &&
    error.cause instanceof WorkspaceTableUnavailableError
      ? error.cause
      : undefined;

  if (!unavailableCause || unavailableCause.reservation.kind !== "cowork") {
    return m.reservationErrorMessage({}, { locale: input.locale });
  }

  return getReservationAvailabilityUnavailableMessage({
    date: unavailableCause.date,
    locale: input.locale,
    tier: unavailableCause.reservation.tier,
  });
};

export const submitWorkspaceReservation = Effect.fn(
  "submitWorkspaceReservation"
)(
  function* (input: SubmitReservationInput) {
    const { locale } = input;
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
      Effect.tapError(() =>
        Effect.logError("Workspace checkout submission failed")
      ),
      Effect.mapError(
        (error) =>
          new PublicSafeActionError({
            message: getSubmitReservationErrorMessage(error, input),
            cause: error,
          })
      )
    )
);
