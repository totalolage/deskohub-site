import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { ReservationQuote } from "@/features/checkout/reservation-quote";
import { workspaceMoneyEquals } from "@/features/checkout/workspace-money";
import type { AppliedDiscount, DiscountCommitment } from "@/features/discounts";
import { getDiscountCommitmentPayload } from "@/features/discounts/commitment";
import {
  getReferralInvitationDiscountId,
  getReferralReferrerDiscountId,
} from "@/features/referrals/discount-identifiers";
import { calculateReferrerDiscountAmount } from "@/features/referrals/referrer-discount";

export const isExpectedReferralQuoteAddition = (input: {
  readonly previous: ReservationQuote;
  readonly current: ReservationQuote;
  readonly commitment: DiscountCommitment;
  readonly dotyposCustomerId: DotyposCustomerId;
}): boolean => {
  const invitationId = getReferralInvitationDiscountId(input.dotyposCustomerId);
  const referrerId = getReferralReferrerDiscountId(input.dotyposCustomerId);
  const referralIds = new Set([invitationId, referrerId]);
  const previousNonReferralDiscounts = input.previous.payment.discounts.filter(
    ({ discount }) => !referralIds.has(discount.id)
  );
  const currentNonReferralDiscounts = input.current.payment.discounts.filter(
    ({ discount }) => !referralIds.has(discount.id)
  );

  if (
    !areEqual(input.previous.items, input.current.items) ||
    !workspaceMoneyEquals(
      input.previous.payment.undiscountedPrice,
      input.current.payment.undiscountedPrice
    ) ||
    !areEqual(previousNonReferralDiscounts, currentNonReferralDiscounts)
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
  if (
    hasDuplicateApplications(input.previous.payment.discounts, invitationId) ||
    hasDuplicateApplications(input.current.payment.discounts, invitationId)
  ) {
    return false;
  }

  let invitationDifference = 0n;
  if (previousInvitation && currentInvitation) {
    if (!areEqual(previousInvitation, currentInvitation)) return false;
    if (
      !isCurrentInvitationApplication({
        application: currentInvitation,
        commitment: input.commitment,
        dotyposCustomerId: input.dotyposCustomerId,
      })
    ) {
      return false;
    }
  } else if (previousInvitation || currentInvitation) {
    if (
      previousInvitation ||
      !currentInvitation ||
      !isExpectedNewInvitationApplication({
        application: currentInvitation,
        commitment: input.commitment,
        dotyposCustomerId: input.dotyposCustomerId,
      })
    ) {
      return false;
    }
    invitationDifference = BigInt(currentInvitation.amount.value);
  }

  const previousReferrer = findApplication(
    input.previous.payment.discounts,
    referrerId
  );
  const currentReferrer = findApplication(
    input.current.payment.discounts,
    referrerId
  );
  if (
    hasDuplicateApplications(input.previous.payment.discounts, referrerId) ||
    hasDuplicateApplications(input.current.payment.discounts, referrerId) ||
    Boolean(previousReferrer) !== Boolean(currentReferrer)
  ) {
    return false;
  }

  let referrerDifference = 0n;
  if (previousReferrer && currentReferrer) {
    if (!sameReferrerDiscountIdentity(previousReferrer, currentReferrer)) {
      return false;
    }
    const eligibleInviteeCount = getCurrentReferrerCount({
      application: currentReferrer,
      commitment: input.commitment,
      dotyposCustomerId: input.dotyposCustomerId,
    });
    if (
      eligibleInviteeCount === undefined ||
      !isReferrerApplicationForCount(previousReferrer, eligibleInviteeCount) ||
      !isReferrerApplicationForCount(currentReferrer, eligibleInviteeCount)
    ) {
      return false;
    }
    referrerDifference =
      BigInt(currentReferrer.amount.value) -
      BigInt(previousReferrer.amount.value);
  }

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

  const expectedCurrentTotal =
    BigInt(input.previous.payment.expectedPrice.value) -
    invitationDifference -
    referrerDifference;

  return (
    input.previous.payment.expectedPrice.currency ===
      input.current.payment.expectedPrice.currency &&
    input.previous.payment.expectedPrice.exponent ===
      input.current.payment.expectedPrice.exponent &&
    expectedCurrentTotal === BigInt(input.current.payment.expectedPrice.value)
  );
};

const isExpectedNewInvitationApplication = (input: {
  readonly application: AppliedDiscount;
  readonly commitment: DiscountCommitment;
  readonly dotyposCustomerId: DotyposCustomerId;
}) => {
  const commitmentApplication = findCommitmentApplication(
    input.commitment,
    input.application.discount.id
  );
  const adjustment = input.application.discount.adjustment;
  return (
    adjustment.kind === "percentage" &&
    adjustment.basisPoints === 1_500 &&
    hasCurrentInvitationProvenance({
      commitmentApplication,
      application: input.application,
      dotyposCustomerId: input.dotyposCustomerId,
    }) &&
    input.application.discount.expiresAt === undefined &&
    input.application.discount.countdownStartsAt === undefined &&
    isApplicationMathValid(input.application) &&
    input.application.amount.value ===
      applyBasisPoints(input.application.subtotalBefore.value, 1_500)
  );
};

const isCurrentInvitationApplication = (input: {
  readonly application: AppliedDiscount;
  readonly commitment: DiscountCommitment;
  readonly dotyposCustomerId: DotyposCustomerId;
}) => {
  const adjustment = input.application.discount.adjustment;
  return (
    adjustment.kind === "percentage" &&
    adjustment.basisPoints === 1_500 &&
    hasCurrentInvitationProvenance({
      commitmentApplication: findCommitmentApplication(
        input.commitment,
        input.application.discount.id
      ),
      application: input.application,
      dotyposCustomerId: input.dotyposCustomerId,
    }) &&
    isApplicationMathValid(input.application) &&
    input.application.amount.value ===
      applyBasisPoints(input.application.subtotalBefore.value, 1_500)
  );
};

const isApplicationMathValid = (application: AppliedDiscount) => {
  const { subtotalBefore, amount, subtotalAfter } = application;
  return (
    subtotalBefore.currency === amount.currency &&
    subtotalBefore.exponent === amount.exponent &&
    subtotalBefore.value >= amount.value &&
    workspaceMoneyEquals(subtotalAfter, {
      ...subtotalBefore,
      value: subtotalBefore.value - amount.value,
    })
  );
};

const isReferrerApplicationForCount = (
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
    workspaceMoneyEquals(adjustment.amount, application.amount) &&
    workspaceMoneyEquals(expectedAmount, application.amount) &&
    isApplicationMathValid(application)
  );
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
  return areEqual(getIdentity(previous), getIdentity(current));
};

const getCurrentReferrerCount = (input: {
  readonly application: AppliedDiscount;
  readonly commitment: DiscountCommitment;
  readonly dotyposCustomerId: DotyposCustomerId;
}) => {
  const commitmentApplication = findCommitmentApplication(
    input.commitment,
    input.application.discount.id
  );
  const details = commitmentApplication?.provenance.details;
  if (
    input.application.discount.id !==
      getReferralReferrerDiscountId(input.dotyposCustomerId) ||
    commitmentApplication?.application === undefined ||
    !areEqual(commitmentApplication.application, input.application) ||
    commitmentApplication.provenance.providerNamespace !==
      "referral-referrer" ||
    !details ||
    !("referralReferrer" in details) ||
    details.referralReferrer.referrerDotyposCustomerId !==
      input.dotyposCustomerId
  ) {
    return undefined;
  }
  const count = details.referralReferrer.eligibleInviteeCount;
  return Number.isSafeInteger(count) && count > 0 ? count : undefined;
};

const hasCurrentInvitationProvenance = (input: {
  readonly commitmentApplication:
    | ReturnType<typeof getDiscountCommitmentPayload>["applications"][number]
    | undefined;
  readonly application: AppliedDiscount;
  readonly dotyposCustomerId: DotyposCustomerId;
}) => {
  const details = input.commitmentApplication?.provenance.details;
  return (
    input.commitmentApplication !== undefined &&
    areEqual(input.commitmentApplication.application, input.application) &&
    input.application.discount.id ===
      getReferralInvitationDiscountId(input.dotyposCustomerId) &&
    input.commitmentApplication.provenance.providerNamespace ===
      "referral-invitation" &&
    input.commitmentApplication.provenance.providerReference.length > 0 &&
    details !== undefined &&
    "referralInvitation" in details &&
    details.referralInvitation.invitedDotyposCustomerId ===
      input.dotyposCustomerId
  );
};

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
  const expectedApplications = [
    ...input.nonReferralDiscounts,
    ...(input.invitation ? [input.invitation] : []),
    ...(input.referrer ? [input.referrer] : []),
  ];
  if (!areEqual(input.quote.payment.discounts, expectedApplications)) {
    return false;
  }
  if (
    input.invitation &&
    !workspaceMoneyEquals(
      input.invitation.subtotalBefore,
      subtotalAfterOrdinaryDiscounts
    )
  ) {
    return false;
  }
  const subtotalBeforeReferrer =
    input.invitation?.subtotalAfter ?? subtotalAfterOrdinaryDiscounts;
  return (
    input.referrer === undefined ||
    workspaceMoneyEquals(input.referrer.subtotalBefore, subtotalBeforeReferrer)
  );
};

const findApplication = (
  applications: readonly AppliedDiscount[],
  discountId: AppliedDiscount["discount"]["id"]
) => applications.find(({ discount }) => discount.id === discountId);

const hasDuplicateApplications = (
  applications: readonly AppliedDiscount[],
  discountId: AppliedDiscount["discount"]["id"]
) =>
  applications.filter(({ discount }) => discount.id === discountId).length > 1;

const findCommitmentApplication = (
  commitment: DiscountCommitment,
  discountId: AppliedDiscount["discount"]["id"]
) =>
  getDiscountCommitmentPayload(commitment).applications.find(
    ({ application }) => application.discount.id === discountId
  );

const applyBasisPoints = (value: number, basisPoints: number) =>
  Number((BigInt(value) * BigInt(basisPoints) + 5_000n) / 10_000n);

const areEqual = <A>(left: A, right: A) =>
  JSON.stringify(left) === JSON.stringify(right);
