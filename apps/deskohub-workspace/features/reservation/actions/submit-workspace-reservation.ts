import { Effect, Match } from "effect";
import { CheckoutService } from "@/features/checkout/backend/checkout";
import { isBookerReferralSettled } from "@/features/checkout/backend/checkout/booker-referral-settlement";
import { m } from "@/features/i18n";
import {
  forgetRememberedReferralCode,
  readRememberedReferralCode,
} from "@/features/referrals/remembered-referral-code.server";
import type { SubmitReservationInput } from "@/features/reservation/actions/submit-reservation-input";
import { WorkspaceTableUnavailableError } from "@/features/reservation/backend/workspace-availability.service";
import { getReservationAvailabilityUnavailableMessage } from "@/features/reservation/reservation.i18n";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { customerAgentNames } from "@/shared/bot-protection/customer-agents";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

/**
 * A paid order records any carried referral, and the booker's first paid
 * order closes their referral window, so the browser's remembered code is of
 * no further use once the booker's own referral is settled. Booking for
 * someone else keeps it. The payment already succeeded, so a failure here is
 * only logged.
 */
const forgetUsedReferralCode = Effect.gen(function* () {
  const rememberedCode = yield* readRememberedReferralCode;
  if (!rememberedCode) return;
  if (!(yield* isBookerReferralSettled({ paid: true }))) return;
  yield* Effect.tryPromise(() => forgetRememberedReferralCode());
}).pipe(
  Effect.catch((cause) =>
    Effect.logWarning("Remembered referral code could not be forgotten", {
      cause,
    })
  )
);

export const submitWorkspaceReservation = Effect.fn(
  "submitWorkspaceReservation"
)(
  function* (input: SubmitReservationInput) {
    const { locale } = input;
    yield* Effect.annotateLogsScoped({ locale });
    const botProtection = yield* BotProtectionService;
    // Pay submit: the customer's own purchase path, so verified customer
    // agents may start the hosted payment the customer completes.
    yield* botProtection.verifyHuman({
      verificationFailurePolicy: "allow",
      verifiedBots: { allow: customerAgentNames },
      callSite: "reservation.submit",
    });
    const service = yield* CheckoutService;
    const checkout = yield* service.createHostedPaymentCheckout(
      {
        payStateToken: input.payStateToken,
        legalConsent: input.legalConsent,
        earlyPerformanceConsent: input.earlyPerformanceConsent,
      },
      locale
    );

    // The signed-in author follows the status page by session, so the
    // checkout sets no access cookie of its own.
    if (checkout.status === "redirect" && checkout.paid) {
      yield* forgetUsedReferralCode;
    }

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
                  m.automatedRequestRejected({}, { locale: input.locale }),
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
                    Match.when("cowork_reservation_ended", () =>
                      m.reservationValidationCoworkEnded(
                        {},
                        { locale: input.locale }
                      )
                    ),
                    Match.when("cowork_offer_replaced", () =>
                      m.reservationValidationCoworkOfferReplaced(
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
