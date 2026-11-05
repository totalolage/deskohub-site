import { Context, Effect, Layer, Match, Schema } from "effect";
import {
  type CheckoutSummary,
  type CheckoutSummaryChangedKeys,
  getCheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import {
  type CanonicalPromotionCode,
  canonicalPromotionCodeSchema,
} from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import { ReferralService } from "@/features/referrals";
import type {
  CheckoutReferralEvaluation,
  ReferralError,
} from "@/features/referrals/contracts";
import {
  type DotyposCustomerId,
  dotyposCustomerIdSchema,
} from "@/features/reservation/dotypos-customer";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { moneyEquals } from "@/shared/money/money";
import { buildFreshCheckoutPayPath } from "./checkout-pay-url";
import {
  CheckoutPricingService,
  type ICheckoutPricingService,
  type PaymentPriceAffirmation,
} from "./checkout-pricing.service";
import { isExpectedReferralQuoteAddition } from "./checkout-referral-price-change";
import {
  getSignedPayStateBookedAt,
  getSignedPayStateCheckoutSummary,
  getSignedPayStateSubmittedCode,
  openPayState,
  type SignedPayState,
} from "./pay-state.server";
import { PayableReservationService } from "./payable-reservation.service";

export type CheckoutReferralResult =
  | {
      readonly status: "accepted" | "already_accepted";
      readonly freshPayUrl: string;
    }
  | {
      readonly status: "unavailable" | "pricing_changed";
      readonly freshPayUrl?: string;
    }
  | {
      /** The customer already has a different, permanent referrer. */
      readonly status: "already_attributed";
    }
  | {
      /** Referral codes apply only to the customer's first paid booking. */
      readonly status: "ineligible";
    };

export interface ICheckoutReferralService {
  readonly acceptCode: (input: {
    readonly code: unknown;
    readonly payStateToken: string;
    readonly locale: Locale;
  }) => Effect.Effect<CheckoutReferralResult>;
}

const unavailable: CheckoutReferralResult = { status: "unavailable" };

/**
 * Only an immutable existing attribution and first-booking ineligibility are
 * explained to the customer; every other failure stays a generic unavailable
 * code so the response cannot probe codes or accounts.
 */
const getAcceptanceRejection = (
  error: ReferralError
): CheckoutReferralResult | undefined => {
  if (error.reason === "already_attributed") {
    return { status: "already_attributed" };
  }
  if (error.reason === "ineligible") return { status: "ineligible" };
  return undefined;
};

/**
 * Only a not-yet-attributed customer carries the typed code; it prices the
 * invitation and is attributed when this order is paid. An already attributed
 * customer keeps whatever code the signed pay state carried.
 */
const getCarriedReferral = (input: {
  readonly evaluation: CheckoutReferralEvaluation;
  readonly opened: SignedPayState;
}): { readonly referralCode?: CanonicalPromotionCode } => {
  const referralCode =
    input.evaluation.kind === "eligible"
      ? canonicalPromotionCodeSchema.make(input.evaluation.code)
      : input.opened.referralCode;
  return referralCode === undefined ? {} : { referralCode };
};

/** Re-prices the signed reservation for payment, carrying the referral. */
const affirmReferralPricing = Effect.fnUntraced(function* (input: {
  readonly pricing: ICheckoutPricingService;
  readonly opened: SignedPayState;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly referralInput: { readonly referralCode?: CanonicalPromotionCode };
}) {
  const { pricing, opened, dotyposCustomerId, locale, referralInput } = input;
  return yield* Match.value(opened).pipe(
    Match.when({ reservation: { kind: "cowork" } }, (state) =>
      pricing.affirmForPayment({
        reservation: state.reservation,
        dotyposCustomerId,
        locale,
        quote: state.quote,
        bookedAt: getSignedPayStateBookedAt(opened),
        ...referralInput,
        // biome-ignore lint/plugin: Preserve exact optional-property typing for the ordinary code slot.
        ...(state.submittedCode === undefined
          ? {}
          : { submittedCode: state.submittedCode }),
      })
    ),
    Match.when({ reservation: { kind: "meeting-room" } }, (state) =>
      pricing.affirmForPayment({
        reservation: state.reservation,
        dotyposCustomerId,
        locale,
        quote: state.quote,
        bookedAt: getSignedPayStateBookedAt(opened),
        ...referralInput,
        // biome-ignore lint/plugin: Preserve exact optional-property typing for the ordinary code slot.
        ...(state.submittedCode === undefined
          ? {}
          : { submittedCode: state.submittedCode }),
      })
    ),
    Match.when({ reservation: { kind: "office" } }, (state) =>
      pricing.affirmForPayment({
        reservation: state.reservation,
        dotyposCustomerId,
        locale,
        quote: state.quote,
        bookedAt: getSignedPayStateBookedAt(opened),
        ...referralInput,
        // biome-ignore lint/plugin: Preserve exact optional-property typing for the ordinary code slot.
        ...(state.submittedCode === undefined
          ? {}
          : { submittedCode: state.submittedCode }),
      })
    ),
    Match.exhaustive
  );
});

/**
 * Whether the referral re-pricing changed the order beyond the expected
 * referral addition, with the summary keys the customer must review.
 */
const getReferralRepricing = (input: {
  readonly opened: SignedPayState;
  readonly prepared: PaymentPriceAffirmation;
  readonly dotyposCustomerId: DotyposCustomerId;
}): {
  readonly changed: boolean;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
} => {
  const { opened, prepared } = input;
  const freshSummary: CheckoutSummary = Match.value(prepared).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ quote, reservation }) =>
        getCoworkCheckoutSummary(reservation, quote),
      "meeting-room": ({ quote }) => getMeetingRoomCheckoutSummary(quote),
      office: ({ quote }) => getOfficeCheckoutSummary(quote),
    })
  );
  const oldSummary: CheckoutSummary = getSignedPayStateCheckoutSummary(opened);
  const quoteChanged = prepared.quote.fingerprint !== opened.quote.fingerprint;
  const acceptedTotalChanged = !moneyEquals(
    freshSummary.total,
    opened.acceptedTotal
  );
  const signedTotalWasConsistent = moneyEquals(
    oldSummary.total,
    opened.acceptedTotal
  );
  const expectedReferralAddition = isExpectedReferralQuoteAddition({
    previous: opened.quote,
    current: prepared.quote,
    commitment: prepared.commitment,
    dotyposCustomerId: input.dotyposCustomerId,
  });
  const changed =
    !signedTotalWasConsistent ||
    ((quoteChanged || acceptedTotalChanged) && !expectedReferralAddition);
  return changed
    ? {
        changed,
        changedKeys: getCheckoutSummaryChangedKeys(oldSummary, freshSummary),
      }
    : { changed };
};

const toReferralAcceptanceResult = (input: {
  readonly changed: boolean;
  readonly evaluation: CheckoutReferralEvaluation;
  readonly freshPayUrl: string;
}): CheckoutReferralResult => {
  if (input.changed) {
    return { status: "pricing_changed", freshPayUrl: input.freshPayUrl };
  }
  return {
    status:
      input.evaluation.kind === "eligible" ? "accepted" : "already_accepted",
    freshPayUrl: input.freshPayUrl,
  };
};

export class CheckoutReferralService extends Context.Service<
  CheckoutReferralService,
  ICheckoutReferralService
>()("@deskohub-workspace/checkout/CheckoutReferralService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const referrals = yield* ReferralService;
      const pricing = yield* CheckoutPricingService;
      const payableReservations = yield* PayableReservationService;
      const sealedStateKeys = yield* SealedStateKeys;

      const acceptCode: ICheckoutReferralService["acceptCode"] = Effect.fn(
        "CheckoutReferralService.acceptCode"
      )(
        function* (input) {
          const opened = yield* openPayState(input.payStateToken);
          if (opened.locale !== input.locale) return unavailable;

          const codeKind = yield* referrals.lookupCodeKind({
            code: input.code,
          });
          if (codeKind.kind !== "referral") return unavailable;

          // The referral belongs to the booked customer: the account's own
          // customer, or the person it books for.
          const currentReservation = yield* payableReservations.requireCurrent({
            orderId: opened.orderId,
            checkoutSessionId: opened.checkoutSessionId,
          });
          const dotyposCustomerId = yield* Schema.decodeEffect(
            dotyposCustomerIdSchema
          )(currentReservation.dotyposCustomerId);

          const evaluation = yield* referrals
            .evaluateCheckoutReferral({ code: input.code, dotyposCustomerId })
            .pipe(Effect.result);
          if (evaluation._tag === "Failure") {
            return (
              getAcceptanceRejection(evaluation.failure) ??
              (yield* evaluation.failure)
            );
          }
          const referralInput = getCarriedReferral({
            evaluation: evaluation.success,
            opened,
          });
          const prepared = yield* affirmReferralPricing({
            pricing,
            opened,
            dotyposCustomerId,
            locale: input.locale,
            referralInput,
          });
          const { changed, changedKeys } = getReferralRepricing({
            opened,
            prepared,
            dotyposCustomerId,
          });
          const freshPayPathInput = {
            ...prepared,
            locale: input.locale,
            orderId: opened.orderId,
            bookedAt: opened.bookedAt,
            checkoutSessionId: opened.checkoutSessionId,
            ...referralInput,
            ...getSignedPayStateSubmittedCode(
              opened,
              prepared.quote.payment.discounts
            ),
          };
          const freshPayUrl = yield* buildFreshCheckoutPayPath(
            changedKeys === undefined
              ? freshPayPathInput
              : { ...freshPayPathInput, changedKeys },
            undefined,
            { orderId: opened.orderId }
          );

          return toReferralAcceptanceResult({
            changed,
            evaluation: evaluation.success,
            freshPayUrl,
          });
        },
        (effect) =>
          effect.pipe(
            Effect.orElseSucceed(() => unavailable),
            Effect.provideService(SealedStateKeys, sealedStateKeys)
          )
      );

      return { acceptCode } satisfies ICheckoutReferralService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        ReferralService.Live,
        CheckoutPricingService.Live,
        PayableReservationService.Live,
        WorkspaceDotyposLayer,
        SealedStateKeys.Default
      )
    )
  );
}
