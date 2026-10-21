import { Effect, Match } from "effect";
import { type Locale, m } from "@/features/i18n";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { customerAgentNames } from "@/shared/bot-protection/customer-agents";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import type { prepareWorkspacePayState } from "./prepare-pay-state";
import type { PreparePayStateInput } from "./prepare-pay-state.schema";

// The reservation form's side of Pay preparation, around the shared booking
// operation the customer MCP server calls too.

/**
 * The reservation form verifies BotID before the shared booking operation
 * creates any state; the MCP server authenticates agents with OAuth instead.
 */
export const verifyReservationFormHuman = (locale: Locale) =>
  BotProtectionService.pipe(
    // Reservation form: the customer's own purchase path, so verified customer
    // agents may continue; sign-in and payment still gate the order.
    Effect.flatMap((botProtection) =>
      botProtection.verifyHuman({
        verificationFailurePolicy: "allow",
        verifiedBots: { allow: customerAgentNames },
        callSite: "reservation.prepare-pay-state",
      })
    ),
    Effect.mapError(
      (error) =>
        new PublicSafeActionError({
          message: Match.value(error).pipe(
            Match.tagsExhaustive({
              BotDetectedError: () =>
                m.automatedRequestRejected({}, { locale }),
              BotVerificationError: () =>
                m.reservationErrorMessage({}, { locale }),
            })
          ),
          cause: error,
        })
    )
  );

/** The reservation form's public message for a failed preparation. */
export const toReservationFormError =
  (input: Pick<PreparePayStateInput, "locale">) =>
  (error: Effect.Error<ReturnType<typeof prepareWorkspacePayState>>) =>
    new PublicSafeActionError({
      message: Match.value(error).pipe(
        Match.tag("UndeliverableContactEmailError", () =>
          m.contactValidationEmailUndeliverable({}, { locale: input.locale })
        ),
        Match.tag("CustomerAccountAccessError", (cause) => {
          if (
            cause.reason === "link-required" &&
            cause.linkReason === "deletion-requested"
          ) {
            return m.accountDeletionPendingError({}, { locale: input.locale });
          }
          if (cause.reason === "unauthenticated") {
            return m.accountSessionExpired({}, { locale: input.locale });
          }
          return m.reservationErrorMessage({}, { locale: input.locale });
        }),
        Match.orElse(() =>
          m.reservationErrorMessage({}, { locale: input.locale })
        )
      ),
      cause: error,
    });
