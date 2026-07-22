import { Effect, Option } from "effect";
import {
  CheckoutService,
  openPayState,
} from "@/features/checkout/backend/checkout";
import { m } from "@/features/i18n";
import type { SubmitReservationInput } from "@/features/reservation/actions/submit-reservation-input";
import { getReservationAvailabilityUnavailableMessage } from "@/features/reservation/reservation.i18n";
import {
  BotDetectedError,
  BotProtectionService,
} from "@/shared/backend/bot-protection/bot-protection.service";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const getSubmitReservationErrorMessage = Effect.fn(
  "getSubmitReservationErrorMessage"
)(function* (
  error: { readonly message: string },
  input: SubmitReservationInput
) {
  if (error instanceof BotDetectedError) {
    return m.reservationRateLimitMessage({}, { locale: input.locale });
  }

  if (error.message !== "workspace_table_unavailable") {
    return m.reservationErrorMessage({}, { locale: input.locale });
  }

  const payState = Option.getOrUndefined(
    yield* openPayState(input.payStateToken).pipe(Effect.option)
  );

  return payState
    ? getReservationAvailabilityUnavailableMessage({
        date: payState.reservation.date,
        locale: input.locale,
        tier: payState.reservation.entryTier,
      })
    : m.reservationErrorMessage({}, { locale: input.locale });
});

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
      Effect.annotateLogs(input),
      Effect.catch((error) =>
        getSubmitReservationErrorMessage(error, input).pipe(
          Effect.flatMap((message) =>
            Effect.fail(
              new PublicSafeActionError({
                message,
                cause: error,
              })
            )
          )
        )
      )
    )
);
