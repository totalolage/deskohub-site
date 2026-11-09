import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { ReservationQuote } from "@/features/checkout/reservation-quote";
import type {
  AppliedDiscount,
  DiscountCommitment,
  DiscountId,
} from "@/features/discounts";
import {
  type DiscountCommitmentPayload,
  getDiscountCommitmentPayload,
} from "@/features/discounts/commitment";
import {
  getReferralBenefitIds,
  matchesReferrerFormula,
  recognizeCommittedReferralBenefit,
} from "@/features/referrals/referral-benefits";
import { type Money, moneyEquals, sameMoneyUnit } from "@/shared/money/money";
import { haveSameJsonEncoding } from "@/shared/utils/json-equal";

export const isExpectedReferralQuoteAddition = (input: {
  readonly previous: ReservationQuote;
  readonly current: ReservationQuote;
  readonly commitment: DiscountCommitment;
  readonly dotyposCustomerId: DotyposCustomerId;
}): boolean => {
  const { invitation: invitationId, referrer: referrerId } =
    getReferralBenefitIds(input.dotyposCustomerId);
  const referralIds = new Set([invitationId, referrerId]);
  const previousNonReferralDiscounts = withoutReferralApplications(
    input.previous,
    referralIds
  );
  const currentNonReferralDiscounts = withoutReferralApplications(
    input.current,
    referralIds
  );

  if (
    !haveSameBasePricing({
      previous: input.previous,
      current: input.current,
      previousNonReferralDiscounts,
      currentNonReferralDiscounts,
    })
  ) {
    return false;
  }

  const previousInvitation = findApplication(
    input.previous.payment.discounts,
    invitationId
  );
  const currentInvitation = findApplication(
    input.current.payment.discounts,
    invitationId
  );
  const invitationDifference = getInvitationDifference({
    ...input,
    invitationId,
    previousInvitation,
    currentInvitation,
  });
  if (invitationDifference === undefined) return false;

  const previousReferrer = findApplication(
    input.previous.payment.discounts,
    referrerId
  );
  const currentReferrer = findApplication(
    input.current.payment.discounts,
    referrerId
  );
  const referrerDifference = getReferrerDifference({
    ...input,
    referrerId,
    previousReferrer,
    currentReferrer,
  });
  if (referrerDifference === undefined) return false;

  if (
    !areReferralApplicationsInSequence({
      quote: input.previous,
      invitation: previousInvitation,
      referrer: previousReferrer,
      nonReferralDiscounts: previousNonReferralDiscounts,
    }) ||
    !areReferralApplicationsInSequence({
      quote: input.current,
      invitation: currentInvitation,
      referrer: currentReferrer,
      nonReferralDiscounts: currentNonReferralDiscounts,
    })
  ) {
    return false;
  }

  return isCurrentTotalExplained({
    ...input,
    invitationDifference,
    referrerDifference,
  });
};

const withoutReferralApplications = (
  quote: ReservationQuote,
  referralIds: ReadonlySet<DiscountId>
) =>
  quote.payment.discounts.filter(
    ({ discount }) => !referralIds.has(discount.id)
  );

/** Items, the undiscounted price, and every non-referral application are unchanged. */
const haveSameBasePricing = (input: {
  readonly previous: ReservationQuote;
  readonly current: ReservationQuote;
  readonly previousNonReferralDiscounts: readonly AppliedDiscount[];
  readonly currentNonReferralDiscounts: readonly AppliedDiscount[];
}) =>
  haveSameJsonEncoding(input.previous.items, input.current.items) &&
  moneyEquals(
    input.previous.payment.undiscountedPrice,
    input.current.payment.undiscountedPrice
  ) &&
  haveSameJsonEncoding(
    input.previousNonReferralDiscounts,
    input.currentNonReferralDiscounts
  );

/**
 * The amount the invitation newly takes off the total: nothing for an
 * unchanged or absent invitation, its amount for the first one, and
 * `undefined` when the invitation change is not the expected addition.
 */
const getInvitationDifference = (input: {
  readonly previous: ReservationQuote;
  readonly current: ReservationQuote;
  readonly commitment: DiscountCommitment;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly invitationId: DiscountId;
  readonly previousInvitation: AppliedDiscount | undefined;
  readonly currentInvitation: AppliedDiscount | undefined;
}): bigint | undefined => {
  if (
    hasDuplicateApplicationsInEither({
      ...input,
      discountId: input.invitationId,
    })
  ) {
    return undefined;
  }
  const { previousInvitation, currentInvitation } = input;
  if (previousInvitation && currentInvitation) {
    return isUnchangedCurrentInvitation({
      ...input,
      previousInvitation,
      currentInvitation,
    })
      ? 0n
      : undefined;
  }
  if (previousInvitation) return undefined;
  if (!currentInvitation) return 0n;
  return isExpectedNewInvitationApplication({
    application: currentInvitation,
    commitment: input.commitment,
    dotyposCustomerId: input.dotyposCustomerId,
  })
    ? BigInt(currentInvitation.amount.value)
    : undefined;
};

const isUnchangedCurrentInvitation = (input: {
  readonly commitment: DiscountCommitment;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly previousInvitation: AppliedDiscount;
  readonly currentInvitation: AppliedDiscount;
}) =>
  haveSameJsonEncoding(input.previousInvitation, input.currentInvitation) &&
  isCurrentInvitationApplication({
    application: input.currentInvitation,
    commitment: input.commitment,
    dotyposCustomerId: input.dotyposCustomerId,
  });

/**
 * How much more the recalculated referrer application takes off the total,
 * or `undefined` when the referrer application appeared, disappeared, or
 * changed beyond a recalculation for the same eligible-invitee count.
 */
const getReferrerDifference = (input: {
  readonly previous: ReservationQuote;
  readonly current: ReservationQuote;
  readonly commitment: DiscountCommitment;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly referrerId: DiscountId;
  readonly previousReferrer: AppliedDiscount | undefined;
  readonly currentReferrer: AppliedDiscount | undefined;
}): bigint | undefined => {
  const { previousReferrer, currentReferrer } = input;
  if (
    hasDuplicateApplicationsInEither({
      ...input,
      discountId: input.referrerId,
    }) ||
    Boolean(previousReferrer) !== Boolean(currentReferrer)
  ) {
    return undefined;
  }
  if (!previousReferrer || !currentReferrer) return 0n;
  return isReferrerRecalculation({
    ...input,
    previousReferrer,
    currentReferrer,
  })
    ? BigInt(currentReferrer.amount.value) -
        BigInt(previousReferrer.amount.value)
    : undefined;
};

const isReferrerRecalculation = (input: {
  readonly commitment: DiscountCommitment;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly previousReferrer: AppliedDiscount;
  readonly currentReferrer: AppliedDiscount;
}) => {
  if (
    !sameReferrerDiscountIdentity(input.previousReferrer, input.currentReferrer)
  ) {
    return false;
  }
  const eligibleInviteeCount = getCurrentReferrerCount({
    application: input.currentReferrer,
    commitment: input.commitment,
    dotyposCustomerId: input.dotyposCustomerId,
  });
  return (
    eligibleInviteeCount !== undefined &&
    matchesReferrerFormula(input.previousReferrer, eligibleInviteeCount) &&
    matchesReferrerFormula(input.currentReferrer, eligibleInviteeCount)
  );
};

const isCurrentTotalExplained = (input: {
  readonly previous: ReservationQuote;
  readonly current: ReservationQuote;
  readonly invitationDifference: bigint;
  readonly referrerDifference: bigint;
}) => {
  const expectedCurrentTotal =
    BigInt(input.previous.payment.expectedPrice.value) -
    input.invitationDifference -
    input.referrerDifference;

  return (
    sameMoneyUnit(
      input.previous.payment.expectedPrice,
      input.current.payment.expectedPrice
    ) &&
    expectedCurrentTotal === BigInt(input.current.payment.expectedPrice.value)
  );
};

const isExpectedNewInvitationApplication = (input: {
  readonly application: AppliedDiscount;
  readonly commitment: DiscountCommitment;
  readonly dotyposCustomerId: DotyposCustomerId;
}) =>
  isCurrentInvitationApplication(input) &&
  input.application.discount.expiresAt === undefined &&
  input.application.discount.countdownStartsAt === undefined;

/** The customer's committed invitation, taking exactly the program rate. */
const isCurrentInvitationApplication = (input: {
  readonly application: AppliedDiscount;
  readonly commitment: DiscountCommitment;
  readonly dotyposCustomerId: DotyposCustomerId;
}) => {
  const recognition = recognizeCommittedApplication(input);
  return recognition.kind === "invitation" && recognition.matchesProgram;
};

const sameReferrerDiscountIdentity = (
  previous: AppliedDiscount,
  current: AppliedDiscount
) => {
  const getIdentity = ({ discount }: AppliedDiscount) => ({
    id: discount.id,
    label: discount.label,
    adjustmentKind: discount.adjustment.kind,
    expiresAt: discount.expiresAt ?? null,
    countdownStartsAt: discount.countdownStartsAt ?? null,
  });
  return haveSameJsonEncoding(getIdentity(previous), getIdentity(current));
};

/** The eligible-invitee count of the customer's committed referrer application. */
const getCurrentReferrerCount = (input: {
  readonly application: AppliedDiscount;
  readonly commitment: DiscountCommitment;
  readonly dotyposCustomerId: DotyposCustomerId;
}) => {
  const recognition = recognizeCommittedApplication(input);
  return recognition.kind === "referrer"
    ? recognition.eligibleInviteeCount
    : undefined;
};

const recognizeCommittedApplication = (input: {
  readonly application: AppliedDiscount;
  readonly commitment: DiscountCommitment;
  readonly dotyposCustomerId: DotyposCustomerId;
}) =>
  recognizeCommittedReferralBenefit({
    dotyposCustomerId: input.dotyposCustomerId,
    application: input.application,
    committed: findCommitmentApplication(
      input.commitment,
      input.application.discount.id
    ),
  });

const areReferralApplicationsInSequence = (input: {
  readonly quote: ReservationQuote;
  readonly invitation?: AppliedDiscount;
  readonly referrer?: AppliedDiscount;
  readonly nonReferralDiscounts: readonly AppliedDiscount[];
}) => {
  const productSubtotal = input.quote.items[0]?.amount;
  if (!productSubtotal) return false;
  const subtotalAfterOrdinaryDiscounts =
    input.nonReferralDiscounts.at(-1)?.subtotalAfter ?? productSubtotal;
  if (
    !haveSameJsonEncoding(
      input.quote.payment.discounts,
      listApplicationsInPricingOrder(input)
    )
  ) {
    return false;
  }
  return areReferralSubtotalsChained({
    ...input,
    subtotalAfterOrdinaryDiscounts,
  });
};

/** Ordinary and customer discounts first, then the invitation, then the referrer. */
const listApplicationsInPricingOrder = (input: {
  readonly invitation?: AppliedDiscount;
  readonly referrer?: AppliedDiscount;
  readonly nonReferralDiscounts: readonly AppliedDiscount[];
}) => [
  ...input.nonReferralDiscounts,
  ...(input.invitation ? [input.invitation] : []),
  ...(input.referrer ? [input.referrer] : []),
];

/** Each referral application starts from the subtotal the previous one left. */
const areReferralSubtotalsChained = (input: {
  readonly invitation?: AppliedDiscount;
  readonly referrer?: AppliedDiscount;
  readonly subtotalAfterOrdinaryDiscounts: Money;
}) => {
  if (
    input.invitation &&
    !moneyEquals(
      input.invitation.subtotalBefore,
      input.subtotalAfterOrdinaryDiscounts
    )
  ) {
    return false;
  }
  const subtotalBeforeReferrer =
    input.invitation?.subtotalAfter ?? input.subtotalAfterOrdinaryDiscounts;
  return (
    input.referrer === undefined ||
    moneyEquals(input.referrer.subtotalBefore, subtotalBeforeReferrer)
  );
};

const findApplication = (
  applications: readonly AppliedDiscount[],
  discountId: DiscountId
) => applications.find(({ discount }) => discount.id === discountId);

const hasDuplicateApplications = (
  applications: readonly AppliedDiscount[],
  discountId: DiscountId
) =>
  applications.filter(({ discount }) => discount.id === discountId).length > 1;

const hasDuplicateApplicationsInEither = (input: {
  readonly previous: ReservationQuote;
  readonly current: ReservationQuote;
  readonly discountId: DiscountId;
}) =>
  hasDuplicateApplications(
    input.previous.payment.discounts,
    input.discountId
  ) ||
  hasDuplicateApplications(input.current.payment.discounts, input.discountId);

type CommitmentApplication = DiscountCommitmentPayload["applications"][number];

const findCommitmentApplication = (
  commitment: DiscountCommitment,
  discountId: DiscountId
): CommitmentApplication | undefined =>
  getDiscountCommitmentPayload(commitment).applications.find(
    ({ application }) => application.discount.id === discountId
  );
