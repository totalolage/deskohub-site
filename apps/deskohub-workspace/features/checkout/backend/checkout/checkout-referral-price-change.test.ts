import { describe, expect, test } from "bun:test";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import {
  type AppliedDiscount,
  type DiscountId,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { promotionCodeIdSchema } from "@/features/discounts/persistence-contracts";
import type { DiscountCandidate } from "@/features/discounts/provider";
import {
  getReferralInvitationDiscountId,
  getReferralReferrerDiscountId,
} from "@/features/referrals/discount-identifiers";
import { calculateReferrerDiscountAmount } from "@/features/referrals/referrer-discount";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { isExpectedReferralQuoteAddition } from "./checkout-referral-price-change";
import type { CoworkReservationQuote } from "./reservation-quote-cowork";

const money = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const invitedCustomerId = dotyposCustomerIdSchema.make(
  "referral-price-change-customer"
);
const referrerCustomerId = dotyposCustomerIdSchema.make(
  "referral-price-change-referrer"
);
const referralPromotionCodeId = promotionCodeIdSchema.make(
  "referral-price-change-code-id"
);
const invitationId = getReferralInvitationDiscountId(invitedCustomerId);
const referrerId = getReferralReferrerDiscountId(invitedCustomerId);
const ordinaryDiscountId = discountIdSchema.make("ordinary-code-discount");

const makeAppliedDiscount = (input: {
  readonly id: DiscountId;
  readonly label: string;
  readonly adjustment:
    | { readonly kind: "percentage"; readonly basisPoints: number }
    | { readonly kind: "fixed"; readonly amount: ReturnType<typeof money> };
  readonly subtotalBefore: number;
  readonly amount: number;
}): AppliedDiscount => ({
  discount: {
    id: input.id,
    label: input.label,
    adjustment: input.adjustment,
  },
  subtotalBefore: money(input.subtotalBefore),
  amount: money(input.amount),
  subtotalAfter: money(input.subtotalBefore - input.amount),
});

const makeOrdinaryDiscount = (input: {
  readonly label: string;
  readonly subtotalBefore: number;
  readonly amount: number;
}): AppliedDiscount => ({
  ...makeAppliedDiscount({
    id: ordinaryDiscountId,
    label: input.label,
    adjustment: { kind: "fixed", amount: money(input.amount) },
    subtotalBefore: input.subtotalBefore,
    amount: input.amount,
  }),
});

const makeInvitationDiscount = (subtotalBefore: number) =>
  makeAppliedDiscount({
    id: invitationId,
    label: "Invitation discount 15%",
    adjustment: { kind: "percentage", basisPoints: 1_500 },
    subtotalBefore,
    amount: Number((BigInt(subtotalBefore) * 1_500n + 5_000n) / 10_000n),
  });

const makeReferrerDiscount = (input: {
  readonly subtotalBefore: number;
  readonly count: number;
}) => {
  const amount = calculateReferrerDiscountAmount({
    eligibleInviteeCount: input.count,
    remainingSubtotal: money(input.subtotalBefore),
  });
  return makeAppliedDiscount({
    id: referrerId,
    label: `Referral discount (${input.count} eligible people)`,
    adjustment: { kind: "fixed", amount },
    subtotalBefore: input.subtotalBefore,
    amount: amount.value,
  });
};

const makeQuote = (
  base: number,
  discounts: readonly AppliedDiscount[]
): CoworkReservationQuote => {
  const totalDiscount = discounts.reduce(
    (total, discount) => total + discount.amount.value,
    0
  );
  return {
    fingerprint: "test-fingerprint",
    items: [
      {
        type: "cowork",
        tier: "reserved-desk",
        amount: money(base),
      },
    ],
    payment: {
      expectedPrice: money(base - totalDiscount),
      undiscountedPrice: money(base),
      discounts,
    },
  };
};

const getCandidate = (application: AppliedDiscount): DiscountCandidate => {
  if (application.discount.id === invitationId) {
    return {
      discount: application.discount,
      provenance: {
        providerNamespace: "referral-invitation",
        providerReference: "accepted-referral-code-id",
        details: {
          referralInvitation: {
            invitedDotyposCustomerId: invitedCustomerId,
            referrerDotyposCustomerId: referrerCustomerId,
            promotionCodeId: referralPromotionCodeId,
          },
        },
      },
    };
  }
  if (application.discount.id === referrerId) {
    return {
      discount: application.discount,
      provenance: {
        providerNamespace: "referral-referrer",
        providerReference: invitedCustomerId,
        details: {
          referralReferrer: {
            referrerDotyposCustomerId: invitedCustomerId,
            eligibleInviteeCount: Number(
              application.discount.label.match(/\d+/)?.[0] ?? 0
            ),
            discountPercentage: "5",
          },
        },
      },
    };
  }
  return {
    discount: application.discount,
    provenance: {
      providerNamespace: "discount-code",
      providerReference: "ordinary-code-id",
    },
  };
};

const makeCommitment = (discounts: readonly AppliedDiscount[]) =>
  makeDiscountCommitment({
    product: { kind: "cowork", tier: "reserved-desk" },
    applications: discounts.map((application) => ({
      application,
      candidate: getCandidate(application),
    })),
  });

describe("expected referral checkout quote addition", () => {
  test("permits the first invitation application and unchanged-count referrer recalculation", () => {
    const oldReferrer = makeReferrerDiscount({
      subtotalBefore: 10_000,
      count: 1,
    });
    const invitation = makeInvitationDiscount(10_000);
    const freshReferrer = makeReferrerDiscount({
      subtotalBefore: invitation.subtotalAfter.value,
      count: 1,
    });

    expect(
      isExpectedReferralQuoteAddition({
        previous: makeQuote(10_000, [oldReferrer]),
        current: makeQuote(10_000, [invitation, freshReferrer]),
        commitment: makeCommitment([invitation, freshReferrer]),
        dotyposCustomerId: invitedCustomerId,
      })
    ).toBe(true);
  });

  test("permits the same expected addition when an old token is retried after acceptance", () => {
    const oldReferrer = makeReferrerDiscount({
      subtotalBefore: 10_000,
      count: 1,
    });
    const invitation = makeInvitationDiscount(10_000);
    const freshReferrer = makeReferrerDiscount({
      subtotalBefore: invitation.subtotalAfter.value,
      count: 1,
    });
    const previous = makeQuote(10_000, [oldReferrer]);
    const current = makeQuote(10_000, [invitation, freshReferrer]);
    const commitment = makeCommitment([invitation, freshReferrer]);

    expect(
      isExpectedReferralQuoteAddition({
        previous,
        current,
        commitment,
        dotyposCustomerId: invitedCustomerId,
      })
    ).toBe(true);
    expect(
      isExpectedReferralQuoteAddition({
        previous,
        current,
        commitment,
        dotyposCustomerId: invitedCustomerId,
      })
    ).toBe(true);
  });

  test("rejects a fresh referrer count or localized count-label change", () => {
    const oldReferrer = makeReferrerDiscount({
      subtotalBefore: 10_000,
      count: 1,
    });
    const invitation = makeInvitationDiscount(10_000);
    const changedReferrer = makeReferrerDiscount({
      subtotalBefore: invitation.subtotalAfter.value,
      count: 2,
    });

    expect(
      isExpectedReferralQuoteAddition({
        previous: makeQuote(10_000, [oldReferrer]),
        current: makeQuote(10_000, [invitation, changedReferrer]),
        commitment: makeCommitment([invitation, changedReferrer]),
        dotyposCustomerId: invitedCustomerId,
      })
    ).toBe(false);
  });

  test("rejects an ordinary-code application that changed during acceptance", () => {
    const previousCode = makeOrdinaryDiscount({
      label: "SUMMER10",
      subtotalBefore: 10_000,
      amount: 1_000,
    });
    const currentCode = makeOrdinaryDiscount({
      label: "SUMMER10",
      subtotalBefore: 10_000,
      amount: 1_200,
    });
    const invitation = makeInvitationDiscount(8_800);
    const referrer = makeReferrerDiscount({
      subtotalBefore: invitation.subtotalAfter.value,
      count: 1,
    });

    expect(
      isExpectedReferralQuoteAddition({
        previous: makeQuote(10_000, [previousCode]),
        current: makeQuote(10_000, [currentCode, invitation, referrer]),
        commitment: makeCommitment([currentCode, invitation, referrer]),
        dotyposCustomerId: invitedCustomerId,
      })
    ).toBe(false);
  });

  test("rejects a changed catalog/base price even when the referral applications are valid", () => {
    const invitation = makeInvitationDiscount(12_000);
    const referrer = makeReferrerDiscount({
      subtotalBefore: invitation.subtotalAfter.value,
      count: 1,
    });

    expect(
      isExpectedReferralQuoteAddition({
        previous: makeQuote(10_000, []),
        current: makeQuote(12_000, [invitation, referrer]),
        commitment: makeCommitment([invitation, referrer]),
        dotyposCustomerId: invitedCustomerId,
      })
    ).toBe(false);
  });

  test("rejects an unexplained final-total difference despite valid referral applications", () => {
    const oldReferrer = makeReferrerDiscount({
      subtotalBefore: 10_000,
      count: 1,
    });
    const invitation = makeInvitationDiscount(10_000);
    const freshReferrer = makeReferrerDiscount({
      subtotalBefore: invitation.subtotalAfter.value,
      count: 1,
    });
    const validCurrent = makeQuote(10_000, [invitation, freshReferrer]);
    const current = {
      ...validCurrent,
      payment: {
        ...validCurrent.payment,
        expectedPrice: money(validCurrent.payment.expectedPrice.value + 1),
      },
    };

    expect(
      isExpectedReferralQuoteAddition({
        previous: makeQuote(10_000, [oldReferrer]),
        current,
        commitment: makeCommitment([invitation, freshReferrer]),
        dotyposCustomerId: invitedCustomerId,
      })
    ).toBe(false);
  });
});
