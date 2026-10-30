import { randomUUID } from "node:crypto";
import { Effect, Match, Option, Schema } from "effect";
import {
  buildFreshCheckoutPayPath,
  CheckoutPricingService,
  CheckoutReferralService,
  getSignedPayStateBookedAt,
  openPayState,
  PayableReservationService,
  PayStateTokenError,
} from "@/features/checkout/backend/checkout";
import type { DiscountCodeRejection } from "@/features/checkout/discount-code-rejection";
import {
  DiscountProviderError,
  normalizeSubmittedPromotionCode,
} from "@/features/discounts";
import { ReferralService } from "@/features/referrals";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { getCalendarActionDeadline } from "@/shared/backend/calendar-action-deadline";
import type { DeploymentEnvironment } from "@/shared/backend/config/deployment-request-timeout";
import { customerAgentNames } from "@/shared/bot-protection/customer-agents";
import type { ApplyDiscountCodeInput } from "./apply-discount-code-input";

/**
 * Discount-code entry affirms the displayed discounts, awaiting one Google
 * Calendar load between its live payable-reservation guards.
 */
export const getApplyDiscountCodeDeadline = (
  deploymentEnvironment: DeploymentEnvironment
) => getCalendarActionDeadline(deploymentEnvironment, 1);

export type ApplyDiscountCodeResult =
  | { readonly status: "applied"; readonly freshPayUrl: string }
  | {
      readonly status: "accepted" | "already_accepted";
      readonly freshPayUrl: string;
    }
  | { readonly status: "pricing_changed"; readonly freshPayUrl: string }
  | {
      readonly status: "already_attributed" | "ineligible";
      /** Signed replacement keeping the rejected referral code in the box. */
      readonly freshPayUrl?: string;
    }
  | {
      readonly status: "unavailable";
      /**
       * Signed replacement carrying the attempted code as requested intent;
       * the correction route must use it so the attempt survives the failure
       * instead of falling back to the previous token.
       */
      readonly freshPayUrl?: string;
    }
  /** BotID rejected the request as automated; the code was not checked. */
  | { readonly status: "automated_request" };

const referralRejections = {
  already_attributed: "referral-already-attributed",
  ineligible: "referral-ineligible",
  unavailable: "unavailable",
} as const satisfies Record<string, DiscountCodeRejection>;

export const applyDiscountCodeToPayState = Effect.fn(
  "checkout.applyDiscountCodeToPayState"
)(
  function* (input: ApplyDiscountCodeInput) {
    const botProtection = yield* BotProtectionService;
    const referrals = yield* ReferralService;
    const checkoutReferrals = yield* CheckoutReferralService;
    const rememberedReferral = yield* RememberedReferral;
    const pricing = yield* CheckoutPricingService;
    const payableReservations = yield* PayableReservationService;

    // Discount code: part of the customer's own purchase, so verified customer
    // agents may enter one; unverified bots get the automated-request status.
    yield* botProtection.verifyHuman({
      verificationFailurePolicy: "deny",
      verifiedBots: { allow: customerAgentNames },
      callSite: "checkout.apply-discount-code",
    });

    const state = yield* openPayState(input.payStateToken);
    if (state.locale !== input.locale) {
      return yield* new PayStateTokenError({
        code: "invalid-token",
        message: "Pay state locale does not match the request locale.",
      });
    }

    if (state.changedKeys || state.submittedCode) {
      return { status: "unavailable" as const, freshPayUrl: undefined };
    }

    // A non-canonical attempt cannot be sealed as intent, so syntax failures
    // keep the plain unavailable result.
    const submittedCode = yield* normalizeSubmittedPromotionCode({
      submittedCode: input.submittedCode,
    }).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.catchTag("PromotionCodeUnavailableError", () =>
        Effect.succeed(undefined)
      )
    );
    if (submittedCode === undefined) {
      return { status: "unavailable" as const, freshPayUrl: undefined };
    }

    const codeKind = yield* referrals.lookupCodeKind({ code: submittedCode });
    if (codeKind.kind === "referral") {
      const result = yield* checkoutReferrals.acceptCode({
        code: submittedCode,
        payStateToken: input.payStateToken,
        locale: input.locale,
      });
      if (
        result.status === "accepted" ||
        result.status === "already_accepted"
      ) {
        // The accepted code replaces any shared-link code, so an order edit
        // keeps it. The signed pay state already carries the referral.
        yield* rememberedReferral
          .remember(submittedCode)
          .pipe(
            Effect.catchTag("RememberedReferralError", () =>
              Effect.logWarning("Accepted referral code was not remembered")
            )
          );
        return result;
      }
      if (
        result.status === "pricing_changed" &&
        result.freshPayUrl !== undefined
      ) {
        return result;
      }
      // A rejected referral code stays in the box, like an unavailable
      // ordinary code, so the customer can see and correct it.
      const status =
        result.status === "already_attributed" || result.status === "ineligible"
          ? result.status
          : ("unavailable" as const);
      const freshPayUrl = yield* buildFreshCheckoutPayPath(
        {
          ...state,
          locale: input.locale,
          orderId: state.orderId,
          checkoutSessionId: state.checkoutSessionId,
          requestedDiscountCode: submittedCode,
        },
        {},
        {
          discountCodeError: referralRejections[status],
          discountCodeErrorId: randomUUID(),
          orderId: state.orderId,
        }
      );
      return { status, freshPayUrl };
    }

    const reservation = yield* payableReservations.requireCurrent({
      orderId: state.orderId,
      checkoutSessionId: state.checkoutSessionId,
    });
    if (reservation.activePaymentAttemptId) {
      return { status: "unavailable" as const, freshPayUrl: undefined };
    }

    const dotyposCustomerId = yield* Schema.decodeEffect(
      dotyposCustomerIdSchema
    )(reservation.dotyposCustomerId).pipe(
      Effect.mapError(
        DiscountProviderError.fromCause({
          reason: "provider_failure",
          message: "Stored customer identity is invalid.",
        })
      )
    );
    const result = yield* pricing
      .applyDiscountCode({
        ...state,
        bookedAt: getSignedPayStateBookedAt(state),
        dotyposCustomerId,
        locale: input.locale,
        submittedCode,
      })
      .pipe(
        // A recoverable invalid-code failure keeps the attempted code as signed
        // requested intent on the correction route instead of the old state.
        Effect.catchTag(
          "PromotionCodeUnavailableError",
          Effect.fn(function* () {
            const freshPayUrl = yield* buildFreshCheckoutPayPath(
              {
                ...state,
                locale: input.locale,
                orderId: state.orderId,
                checkoutSessionId: state.checkoutSessionId,
                requestedDiscountCode: submittedCode,
              },
              {},
              {
                discountCodeError: "unavailable",
                discountCodeErrorId: randomUUID(),
                orderId: state.orderId,
              }
            );
            return { status: "unavailable" as const, freshPayUrl };
          })
        )
      );
    const currentReservation = yield* payableReservations.requireCurrent({
      orderId: state.orderId,
      checkoutSessionId: state.checkoutSessionId,
    });
    if (currentReservation.activePaymentAttemptId) {
      return { status: "unavailable" as const, freshPayUrl: undefined };
    }

    if (result.status === "unavailable") {
      return result;
    }

    const freshPayUrl = yield* Match.value(result).pipe(
      Match.discriminatorsExhaustive("status")({
        applied: (applied) =>
          buildFreshCheckoutPayPath(
            {
              ...applied,
              locale: input.locale,
              orderId: state.orderId,
              bookedAt: state.bookedAt,
              checkoutSessionId: state.checkoutSessionId,
              submittedCode,
              submittedCodeDiscountId: applied.submittedCodeDiscountId,
              requestedDiscountCode: submittedCode,
              referralCode: state.referralCode,
            },
            {},
            { orderId: state.orderId }
          ),
        pricing_changed: (changed) =>
          buildFreshCheckoutPayPath(
            {
              ...changed,
              locale: input.locale,
              orderId: state.orderId,
              bookedAt: state.bookedAt,
              checkoutSessionId: state.checkoutSessionId,
              changedKeys: changed.changedKeys,
              requestedDiscountCode: submittedCode,
              referralCode: state.referralCode,
            },
            {},
            { orderId: state.orderId }
          ),
      })
    );

    return { status: result.status, freshPayUrl };
  },
  (effect) =>
    effect.pipe(
      Effect.catchTags({
        BotDetectedError: () =>
          Effect.succeed({ status: "automated_request" as const }),
        // The displayed discounts could not be affirmed, so the code is not
        // applied and the existing summary stays payable for a retry.
        DiscountAffirmationUnavailableError: () =>
          Effect.succeed({
            status: "unavailable" as const,
            freshPayUrl: undefined,
          }),
        DiscountProviderError: () =>
          Effect.succeed({
            status: "unavailable" as const,
            freshPayUrl: undefined,
          }),
        ReferralError: () =>
          Effect.succeed({
            status: "unavailable" as const,
            freshPayUrl: undefined,
          }),
        PayableReservationUnavailableError: () =>
          Effect.succeed({
            status: "unavailable" as const,
            freshPayUrl: undefined,
          }),
      })
    )
);
