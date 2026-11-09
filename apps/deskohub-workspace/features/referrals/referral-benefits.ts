import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect } from "effect";
import {
  appendDiscountCalculation,
  applyBasisPoints,
  type DiscountCalculation,
  isApplicationArithmeticConsistent,
} from "@/features/discounts/calculator";
import type {
  AppliedDiscount,
  Discount,
  DiscountAdjustment,
  DiscountQuote,
} from "@/features/discounts/contracts";
import { deriveOpaqueDiscountId } from "@/features/discounts/opaque-discount-id";
import type { PromotionCodeId } from "@/features/discounts/persistence-contracts";
import type {
  DiscountCandidate,
  DiscountProvenance,
} from "@/features/discounts/provider";
import { type Locale, m } from "@/features/i18n";
import { type Money, moneyEquals } from "@/shared/money/money";
import { haveSameJsonEncoding } from "@/shared/utils/json-equal";
import { referralInvitationDiscountBasisPoints } from "./program";
import {
  calculateReferrerDiscountAmount,
  formatReferrerDiscountPercentage,
} from "./referrer-discount";

// The two benefits a referral grants: the invited customer's first-booking
// invitation and the referrer's compounding discount. This module owns their
// identity, their candidates, how they are priced, and how an application is
// recognized as one.

const invitationNamespace = "referral-invitation";
const referrerNamespace = "referral-referrer";

/**
 * The public discount IDs of a customer's own referral benefits. Stored
 * applications, savings, and signed quotes carry them, so they never change.
 */
export const getReferralBenefitIds = (
  dotyposCustomerId: DotyposCustomerId
) => ({
  invitation: deriveOpaqueDiscountId({
    providerNamespace: invitationNamespace,
    providerReference: dotyposCustomerId,
  }),
  referrer: deriveOpaqueDiscountId({
    providerNamespace: referrerNamespace,
    providerReference: dotyposCustomerId,
  }),
});

/** Both benefit IDs, invitation first, for filters and savings. */
export const listReferralBenefitIds = (
  dotyposCustomerId: DotyposCustomerId
) => {
  const { invitation, referrer } = getReferralBenefitIds(dotyposCustomerId);
  return [invitation, referrer];
};

export const getReferralInvitationLabel = (locale: Locale) =>
  m.checkoutSummaryItemReferralInvitationDiscount({}, { locale });

/** The invited customer's 15% first-booking candidate and its claim. */
export const makeReferralInvitationCandidate = (input: {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly referral: {
    readonly referrerDotyposCustomerId: DotyposCustomerId;
    readonly promotionCodeId: PromotionCodeId;
  };
}): DiscountCandidate => ({
  discount: {
    id: getReferralBenefitIds(input.dotyposCustomerId).invitation,
    label: getReferralInvitationLabel(input.locale),
    adjustment: {
      kind: "percentage" as const,
      basisPoints: referralInvitationDiscountBasisPoints,
    },
  },
  provenance: {
    providerNamespace: invitationNamespace,
    providerReference: input.referral.promotionCodeId,
    details: {
      referralInvitation: {
        invitedDotyposCustomerId: input.dotyposCustomerId,
        referrerDotyposCustomerId: input.referral.referrerDotyposCustomerId,
        promotionCodeId: input.referral.promotionCodeId,
      },
    },
  },
  claim: {
    kind: "referral_invitation" as const,
    invitedDotyposCustomerId: input.dotyposCustomerId,
    referrerDotyposCustomerId: input.referral.referrerDotyposCustomerId,
    promotionCodeId: input.referral.promotionCodeId,
  },
});

/**
 * The referrer's fixed-money candidate on the exact remaining subtotal, or
 * `undefined` without eligible invitees or when it rounds to nothing.
 */
export const makeReferralReferrerCandidate = (input: {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly eligibleInviteeCount: number;
  readonly remainingSubtotal: Money;
}): DiscountCandidate | undefined => {
  const count = input.eligibleInviteeCount;
  if (count === 0) return undefined;
  const amount = calculateReferrerDiscountAmount({
    eligibleInviteeCount: count,
    remainingSubtotal: input.remainingSubtotal,
  });
  if (amount.value === 0) return undefined;
  return {
    discount: {
      id: getReferralBenefitIds(input.dotyposCustomerId).referrer,
      label: m.checkoutSummaryItemReferralDiscount(
        { count: count.toString() },
        { locale: input.locale }
      ),
      adjustment: { kind: "fixed" as const, amount },
    },
    provenance: {
      providerNamespace: referrerNamespace,
      providerReference: input.dotyposCustomerId,
      details: {
        referralReferrer: {
          referrerDotyposCustomerId: input.dotyposCustomerId,
          eligibleInviteeCount: count,
          discountPercentage: formatReferrerDiscountPercentage(count),
        },
      },
    },
  };
};

/**
 * Prices the referral phase on a quote that already carries the ordinary and
 * customer discounts: the invitation first, then the referrer on the exact
 * subtotal the invitation leaves. A candidate that takes nothing adds no
 * application. The caller resolves each candidate and decides what a failed
 * resolution means.
 */
export const priceReferralBenefits = Effect.fn("ReferralBenefits.price")(
  function* <EI, RI, ER, RR>(input: {
    readonly baseQuote: DiscountQuote;
    readonly invitation: Effect.Effect<DiscountCandidate | undefined, EI, RI>;
    readonly referrer: (
      remainingSubtotal: Money
    ) => Effect.Effect<DiscountCandidate | undefined, ER, RR>;
  }) {
    const invitation = yield* input.invitation;
    const invited = yield* appendDiscountCalculation({
      baseQuote: input.baseQuote,
      candidates: invitation ? [invitation] : [],
    });
    const referrer = yield* input.referrer(invited.quote.discountedSubtotal);
    const referred = yield* appendDiscountCalculation({
      baseQuote: invited.quote,
      candidates: referrer ? [referrer] : [],
    });
    return {
      quote: referred.quote,
      applications: [...invited.applications, ...referred.applications],
    } satisfies DiscountCalculation;
  }
);

export type ReferralBenefitRecognition =
  | { readonly kind: "invitation"; readonly offersProgramRate: boolean }
  | { readonly kind: "referrer" }
  | { readonly kind: "other" };

/** Which of the customer's own referral benefits a discount presents. */
export const recognizeReferralBenefit = (input: {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly discount: Discount;
}): ReferralBenefitRecognition => {
  const ids = getReferralBenefitIds(input.dotyposCustomerId);
  if (input.discount.id === ids.invitation) {
    return {
      kind: "invitation",
      offersProgramRate: offersInvitationRate(input.discount.adjustment),
    };
  }
  if (input.discount.id === ids.referrer) return { kind: "referrer" };
  return { kind: "other" };
};

export type CommittedReferralBenefitRecognition =
  | { readonly kind: "invitation"; readonly matchesProgram: boolean }
  | { readonly kind: "referrer"; readonly eligibleInviteeCount: number }
  | { readonly kind: "unrecognized" };

/**
 * Recognizes the customer's own referral benefit from the committed
 * snapshot: the commitment must hold this exact application, and its
 * provenance must name this customer. An invitation matches the program when
 * it takes exactly the invitation rate of its subtotal. A referrer carries
 * the committed eligible-invitee count.
 */
export const recognizeCommittedReferralBenefit = (input: {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly application: AppliedDiscount;
  readonly committed:
    | {
        readonly application: AppliedDiscount;
        readonly provenance: DiscountProvenance;
      }
    | undefined;
}): CommittedReferralBenefitRecognition => {
  const { application, committed, dotyposCustomerId } = input;
  if (
    committed === undefined ||
    !haveSameJsonEncoding(committed.application, application)
  ) {
    return { kind: "unrecognized" };
  }
  const ids = getReferralBenefitIds(dotyposCustomerId);
  const { details, providerNamespace, providerReference } =
    committed.provenance;

  if (application.discount.id === ids.invitation) {
    return providerNamespace === invitationNamespace &&
      providerReference.length > 0 &&
      details !== undefined &&
      "referralInvitation" in details &&
      details.referralInvitation.invitedDotyposCustomerId === dotyposCustomerId
      ? {
          kind: "invitation",
          matchesProgram: takesExactInvitationRate(application),
        }
      : { kind: "unrecognized" };
  }

  if (
    application.discount.id === ids.referrer &&
    providerNamespace === referrerNamespace &&
    details !== undefined &&
    "referralReferrer" in details &&
    details.referralReferrer.referrerDotyposCustomerId === dotyposCustomerId
  ) {
    const count = details.referralReferrer.eligibleInviteeCount;
    return Number.isSafeInteger(count) && count > 0
      ? { kind: "referrer", eligibleInviteeCount: count }
      : { kind: "unrecognized" };
  }

  return { kind: "unrecognized" };
};

/**
 * Whether a referrer application takes exactly the referrer formula for the
 * count from its own subtotal.
 */
export const matchesReferrerFormula = (
  application: AppliedDiscount,
  eligibleInviteeCount: number
) => {
  const adjustment = application.discount.adjustment;
  const expectedAmount = calculateReferrerDiscountAmount({
    eligibleInviteeCount,
    remainingSubtotal: application.subtotalBefore,
  });
  return (
    adjustment.kind === "fixed" &&
    moneyEquals(adjustment.amount, application.amount) &&
    moneyEquals(expectedAmount, application.amount) &&
    isApplicationArithmeticConsistent(application)
  );
};

const offersInvitationRate = (adjustment: DiscountAdjustment) =>
  adjustment.kind === "percentage" &&
  adjustment.basisPoints === referralInvitationDiscountBasisPoints;

const takesExactInvitationRate = (application: AppliedDiscount) =>
  offersInvitationRate(application.discount.adjustment) &&
  isApplicationArithmeticConsistent(application) &&
  application.amount.value ===
    applyBasisPoints(
      application.subtotalBefore.value,
      referralInvitationDiscountBasisPoints
    );
