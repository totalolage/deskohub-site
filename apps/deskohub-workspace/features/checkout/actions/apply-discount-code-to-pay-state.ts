import { randomUUID } from "node:crypto";
import { Effect, Match, Option, Schema } from "effect";
import {
  CheckoutPricingService,
  CheckoutReferralService,
  getSignedPayStateBookedAt,
  issueFreshPayState,
  openPayStateForLocale,
  PayableReservationService,
} from "@/features/checkout/backend/checkout";
import {
  type FreshPayState,
  type NoFreshPayState,
  toFreshPayState,
} from "@/features/checkout/backend/checkout/checkout-pay-url";
import type { CheckoutReferralResult } from "@/features/checkout/backend/checkout/checkout-referral.service";
import type { SignedPayState } from "@/features/checkout/backend/checkout/pay-state";
import type { PayableReservationUnavailableError } from "@/features/checkout/backend/checkout/payable-reservation.service";
import type { DiscountCodeRejection } from "@/features/checkout/discount-code-rejection";
import {
  type CanonicalPromotionCode,
  DiscountProviderError,
  normalizeSubmittedPromotionCode,
} from "@/features/discounts";
import { ReferralService } from "@/features/referrals";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { getCalendarActionDeadline } from "@/shared/backend/calendar-action-deadline";
import type { DeploymentEnvironment } from "@/shared/deployment/deployment-stage";
import type { ApplyDiscountCodeInput } from "./apply-discount-code-input";

/**
 * Discount-code entry affirms the displayed discounts, awaiting one Google
 * Calendar load between its live payable-reservation guards.
 */
export const getApplyDiscountCodeDeadline = (
  deploymentEnvironment: DeploymentEnvironment
) => getCalendarActionDeadline(deploymentEnvironment, 1);

/**
 * Why a code was not applied. The site shows one generic unavailable field
 * error for every reason; other callers tell a retry from a correction.
 */
export type DiscountCodeUnavailable =
  | {
      readonly status: "unavailable";
      /**
       * `code`: the code is invalid, unknown or can't be used here.
       * `provider`: pricing, discounts or referrals were unreachable, so a
       * retry can work. `price_review_pending`: the customer must first
       * review a price change. `code_already_applied`: the order already
       * carries a code.
       */
      readonly reason:
        | "code"
        | "provider"
        | "price_review_pending"
        | "code_already_applied";
    }
  | {
      readonly status: "unavailable";
      /** The reservation can't be paid now, or a payment already started. */
      readonly reason: "checkout";
      readonly checkoutReason:
        | "payment_in_progress"
        | PayableReservationUnavailableError["reason"];
    };

/**
 * A rejection's replacement Pay state, when it has one, carries the attempted
 * code as signed requested intent; the correction route must use it so the
 * attempt survives the failure instead of falling back to the previous token.
 */
type RejectionReplacement = FreshPayState | NoFreshPayState;

export type ApplyDiscountCodeResult =
  | ({ readonly status: "applied" } & FreshPayState)
  | ({ readonly status: "accepted" } & FreshPayState)
  | ({ readonly status: "already_accepted" } & FreshPayState)
  | ({ readonly status: "pricing_changed" } & FreshPayState)
  | ({ readonly status: "already_attributed" } & RejectionReplacement)
  | ({ readonly status: "ineligible" } & RejectionReplacement)
  | (DiscountCodeUnavailable & RejectionReplacement);

const referralRejections = {
  already_attributed: "referral-already-attributed",
  ineligible: "referral-ineligible",
  unavailable: "unavailable",
} as const satisfies Record<string, DiscountCodeRejection>;

/** A canonical code entered on a pay state signed for the request's language. */
type DiscountCodeEntry = {
  readonly input: ApplyDiscountCodeInput;
  readonly state: SignedPayState;
  readonly submittedCode: CanonicalPromotionCode;
};

/**
 * A replacement Pay state that keeps a rejected code in the box as signed
 * requested intent, with the field error to show beside it.
 */
const issueRejectedCodePayState = (
  { input, state, submittedCode }: DiscountCodeEntry,
  discountCodeError: DiscountCodeRejection
) =>
  issueFreshPayState(
    {
      ...state,
      locale: input.locale,
      orderId: state.orderId,
      checkoutSessionId: state.checkoutSessionId,
      requestedDiscountCode: submittedCode,
    },
    {},
    {
      discountCodeError,
      discountCodeErrorId: randomUUID(),
      orderId: state.orderId,
    }
  ).pipe(Effect.map(toFreshPayState));

/** Unavailable results without a replacement Pay state. */
const unavailableBecause = (
  cause: DiscountCodeUnavailable
): DiscountCodeUnavailable & NoFreshPayState => ({
  ...cause,
  freshPayUrl: undefined,
});

const providerUnavailable = unavailableBecause({
  status: "unavailable",
  reason: "provider",
});

const paymentInProgress = unavailableBecause({
  status: "unavailable",
  reason: "checkout",
  checkoutReason: "payment_in_progress",
});

/**
 * Accepts a referral code through the checkout referral flow, which signs its
 * own replacement pay state.
 */
const acceptReferralCode = Effect.fnUntraced(function* (
  entry: DiscountCodeEntry
) {
  const checkoutReferrals = yield* CheckoutReferralService;
  const rememberedReferral = yield* RememberedReferral;

  const result = yield* checkoutReferrals.acceptCode({
    code: entry.submittedCode,
    payStateToken: entry.input.payStateToken,
    locale: entry.input.locale,
  });
  if (result.status === "accepted" || result.status === "already_accepted") {
    // The accepted code replaces any shared-link code, so an order edit
    // keeps it. The signed pay state already carries the referral.
    yield* rememberedReferral
      .remember(entry.submittedCode)
      .pipe(
        Effect.catchTag("RememberedReferralError", () =>
          Effect.logWarning("Accepted referral code was not remembered")
        )
      );
    return result;
  }
  if (result.status === "pricing_changed" && result.freshPayUrl !== undefined) {
    return result;
  }
  // A started payment blocks the checkout, not the code: like an ordinary
  // code, it signs no replacement.
  if (
    result.status === "unavailable" &&
    result.reason === "checkout" &&
    result.checkoutReason === "payment_in_progress"
  ) {
    return paymentInProgress;
  }
  return yield* rejectReferralCode(entry, result);
});

/**
 * A rejected referral code stays in the box, like an unavailable ordinary
 * code, so the customer can see and correct it.
 */
const rejectReferralCode = Effect.fnUntraced(function* (
  entry: DiscountCodeEntry,
  rejection: Exclude<
    CheckoutReferralResult,
    { readonly status: "accepted" | "already_accepted" }
  >
) {
  const outcome = getReferralRejection(rejection);
  const freshPayState = yield* issueRejectedCodePayState(
    entry,
    referralRejections[outcome.status]
  );
  const rejected: ApplyDiscountCodeResult = { ...outcome, ...freshPayState };
  return rejected;
});

/** The apply outcome for a referral the checkout referral flow rejected. */
const getReferralRejection = (
  rejection: Exclude<
    CheckoutReferralResult,
    { readonly status: "accepted" | "already_accepted" }
  >
):
  | { readonly status: "already_attributed" | "ineligible" }
  | DiscountCodeUnavailable =>
  Match.value(rejection).pipe(
    Match.discriminatorsExhaustive("status")({
      already_attributed: () => ({ status: "already_attributed" as const }),
      ineligible: () => ({ status: "ineligible" as const }),
      unavailable: (unavailable) => unavailable,
      // A price change the referral flow could not sign is unexpected.
      pricing_changed: () => ({
        status: "unavailable" as const,
        reason: "provider" as const,
      }),
    })
  );

/**
 * Prices an ordinary promotion code against the payable reservation, between
 * two live guards that no payment attempt has started.
 */
const applyPromotionCode = Effect.fnUntraced(function* (
  entry: DiscountCodeEntry
) {
  const pricing = yield* CheckoutPricingService;
  const payableReservations = yield* PayableReservationService;
  const { input, state, submittedCode } = entry;

  const reservation = yield* payableReservations.requireCurrent({
    orderId: state.orderId,
    checkoutSessionId: state.checkoutSessionId,
  });
  if (reservation.activePaymentAttemptId) return paymentInProgress;

  const dotyposCustomerId = yield* Schema.decodeEffect(dotyposCustomerIdSchema)(
    reservation.dotyposCustomerId
  ).pipe(
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
      Effect.catchTag("PromotionCodeUnavailableError", () =>
        issueRejectedCodePayState(entry, "unavailable").pipe(
          Effect.map(
            (freshPayState): DiscountCodeUnavailable & FreshPayState => ({
              status: "unavailable",
              reason: "code",
              ...freshPayState,
            })
          )
        )
      )
    );
  const currentReservation = yield* payableReservations.requireCurrent({
    orderId: state.orderId,
    checkoutSessionId: state.checkoutSessionId,
  });
  if (currentReservation.activePaymentAttemptId) return paymentInProgress;

  if (result.status === "unavailable") {
    return result;
  }

  const freshPayState = yield* Match.value(result).pipe(
    Match.discriminatorsExhaustive("status")({
      applied: (applied) =>
        issueFreshPayState(
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
        issueFreshPayState(
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

  const priced: ApplyDiscountCodeResult = {
    status: result.status,
    ...toFreshPayState(freshPayState),
  };
  return priced;
});

export const applyDiscountCodeToPayState = Effect.fn(
  "checkout.applyDiscountCodeToPayState"
)(
  function* (input: ApplyDiscountCodeInput) {
    const referrals = yield* ReferralService;

    const state = yield* openPayStateForLocale(input);

    if (state.changedKeys) {
      return unavailableBecause({
        status: "unavailable",
        reason: "price_review_pending",
      });
    }
    if (state.submittedCode) {
      return unavailableBecause({
        status: "unavailable",
        reason: "code_already_applied",
      });
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
      return unavailableBecause({ status: "unavailable", reason: "code" });
    }

    // A registry that can't classify the code applies nothing; a retry can
    // still work.
    const codeKind = yield* referrals
      .lookupCodeKind({ code: submittedCode })
      .pipe(Effect.orElseSucceed(() => undefined));
    if (codeKind === undefined) return providerUnavailable;
    const entry = { input, state, submittedCode };
    return yield* codeKind.kind === "referral"
      ? acceptReferralCode(entry)
      : applyPromotionCode(entry);
  },
  (effect) =>
    effect.pipe(
      Effect.catchTags({
        // The displayed discounts could not be affirmed, so the code is not
        // applied and the existing summary stays payable for a retry.
        DiscountAffirmationUnavailableError: () =>
          Effect.succeed(providerUnavailable),
        DiscountProviderError: () => Effect.succeed(providerUnavailable),
        PayableReservationUnavailableError: (error) =>
          Effect.succeed(
            unavailableBecause({
              status: "unavailable",
              reason: "checkout",
              checkoutReason: error.reason,
            })
          ),
      })
    )
);
