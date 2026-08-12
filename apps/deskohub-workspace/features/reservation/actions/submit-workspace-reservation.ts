import { Effect, Match } from "effect";
import { CheckoutService } from "@/features/checkout/backend/checkout";
import { m } from "@/features/i18n";
import type { SubmitReservationInput } from "@/features/reservation/actions/submit-reservation-input";
import { WorkspaceTableUnavailableError } from "@/features/reservation/backend/workspace-availability.service";
import { getReservationAvailabilityUnavailableMessage } from "@/features/reservation/reservation.i18n";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

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
        earlyPerformanceConsent: input.earlyPerformanceConsent,
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
            message: Match.value(error).pipe(
              Match.tagsExhaustive({
                BotDetectedError: () =>
                  m.reservationRateLimitMessage({}, { locale: input.locale }),
                BotVerificationError: () =>
                  m.reservationErrorMessage({}, { locale: input.locale }),
                CheckoutError: (checkoutError) =>
                  Match.value(checkoutError.code).pipe(
                    Match.when("meeting_room_reservation_ended", () =>
                      m.reservationValidationMeetingRoomEnded(
                        {},
                        { locale: input.locale }
                      )
                    ),
                    Match.when("office_reservation_ended", () =>
                      m.reservationValidationOfficeEnded(
                        {},
                        { locale: input.locale }
                      )
                    ),
                    Match.when("checkout_failed", () =>
                      Match.value(checkoutError.cause).pipe(
                        Match.when(
                          Match.instanceOf(WorkspaceTableUnavailableError),
                          (unavailable) =>
                            getReservationAvailabilityUnavailableMessage({
                              date: unavailable.date,
                              locale: input.locale,
                              reservation: unavailable.reservation,
                            })
                        ),
                        Match.orElse(() =>
                          m.reservationErrorMessage(
                            {},
                            { locale: input.locale }
                          )
                        )
                      )
                    ),
                    Match.exhaustive
                  ),
              })
            ),
            cause: error,
          })
      )
    )
);
