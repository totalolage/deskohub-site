import { describe, expect, test } from "bun:test";
import type { CoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import {
  type AppliedDiscount,
  type DiscountId,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { promotionCodeIdSchema } from "@/features/discounts/persistence-contracts";
import type { DiscountCandidate } from "@/features/discounts/provider";
import { getReferralBenefitIds } from "@/features/referrals/referral-benefits";
import { calculateReferrerDiscountAmount } from "@/features/referrals/referrer-discount";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { isExpectedReferralQuoteAddition } from "./checkout-referral-price-change";

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
const invitationId = getReferralBenefitIds(invitedCustomerId).invitation;
const referrerId = getReferralBenefitIds(invitedCustomerId).referrer;
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

const makeCommitment = (
  discounts: readonly AppliedDiscount[],
  overrideCandidate: (
    candidate: DiscountCandidate,
    application: AppliedDiscount
  ) => DiscountCandidate = (candidate) => candidate
) =>
  makeDiscountCommitment({
    product: { kind: "cowork", tier: "reserved-desk" },
    applications: discounts.map((application) => ({
      application,
      candidate: overrideCandidate(getCandidate(application), application),
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

describe("referral checkout quote comparison outcomes", () => {
  const invitation = makeInvitationDiscount(10_000);
  const referrer = makeReferrerDiscount({
    subtotalBefore: invitation.subtotalAfter.value,
    count: 1,
  });
  const previousReferrer = makeReferrerDiscount({
    subtotalBefore: 10_000,
    count: 1,
  });
  const ordinaryCode = makeOrdinaryDiscount({
    label: "SUMMER10",
    subtotalBefore: 10_000,
    amount: 1_000,
  });
  const withDiscount = (
    application: AppliedDiscount,
    discount: Partial<AppliedDiscount["discount"]>
  ): AppliedDiscount => ({
    ...application,
    discount: { ...application.discount, ...discount },
  });
  const withProvenance =
    (
      discountId: DiscountId,
      provenance: Partial<DiscountCandidate["provenance"]>
    ) =>
    (candidate: DiscountCandidate, application: AppliedDiscount) =>
      application.discount.id === discountId
        ? {
            ...candidate,
            provenance: { ...candidate.provenance, ...provenance },
          }
        : candidate;
  const withReferrerDetails = (
    details: Partial<{
      readonly referrerDotyposCustomerId: typeof invitedCustomerId;
      readonly eligibleInviteeCount: number;
    }>
  ) =>
    withProvenance(referrerId, {
      details: {
        referralReferrer: {
          referrerDotyposCustomerId: invitedCustomerId,
          eligibleInviteeCount: 1,
          discountPercentage: "5",
          ...details,
        },
      },
    });
  const compare = (input: {
    readonly previous: readonly AppliedDiscount[];
    readonly current: readonly AppliedDiscount[];
    readonly commitment?: ReturnType<typeof makeCommitment>;
    readonly previousQuote?: CoworkReservationQuote;
    readonly currentQuote?: CoworkReservationQuote;
  }) =>
    isExpectedReferralQuoteAddition({
      previous: input.previousQuote ?? makeQuote(10_000, input.previous),
      current: input.currentQuote ?? makeQuote(10_000, input.current),
      commitment: input.commitment ?? makeCommitment(input.current),
      dotyposCustomerId: invitedCustomerId,
    });

  test("accepts unchanged quotes with and without referral applications", () => {
    expect(compare({ previous: [], current: [] })).toBe(true);
    expect(compare({ previous: [ordinaryCode], current: [ordinaryCode] })).toBe(
      true
    );
    expect(
      compare({
        previous: [invitation, referrer],
        current: [invitation, referrer],
      })
    ).toBe(true);
  });

  test("accepts the invitation and referrer recalculation after an unchanged ordinary code", () => {
    const codeInvitation = makeInvitationDiscount(9_000);
    expect(
      compare({
        previous: [
          ordinaryCode,
          makeReferrerDiscount({ subtotalBefore: 9_000, count: 1 }),
        ],
        current: [
          ordinaryCode,
          codeInvitation,
          makeReferrerDiscount({
            subtotalBefore: codeInvitation.subtotalAfter.value,
            count: 1,
          }),
        ],
      })
    ).toBe(true);
  });

  test("rejects a carried invitation that changed, lost its proof or is not the referral percentage", () => {
    const relabelled = withDiscount(invitation, { label: "Changed" });
    expect(compare({ previous: [invitation], current: [relabelled] })).toBe(
      false
    );
    expect(
      compare({
        previous: [invitation],
        current: [invitation],
        commitment: makeCommitment(
          [invitation],
          withProvenance(invitationId, { providerNamespace: "discount-code" })
        ),
      })
    ).toBe(false);
    const tenPercent = makeAppliedDiscount({
      id: invitationId,
      label: "Invitation discount 10%",
      adjustment: { kind: "percentage", basisPoints: 1_000 },
      subtotalBefore: 10_000,
      amount: 1_000,
    });
    expect(compare({ previous: [tenPercent], current: [tenPercent] })).toBe(
      false
    );
  });

  test("rejects a removed or duplicated invitation", () => {
    expect(compare({ previous: [invitation], current: [] })).toBe(false);
    expect(compare({ previous: [], current: [invitation, invitation] })).toBe(
      false
    );
    expect(
      compare({ previous: [invitation, invitation], current: [invitation] })
    ).toBe(false);
  });

  test("rejects a new invitation with a deadline, another adjustment, a wrong amount or inconsistent math", () => {
    const rejected = [
      withDiscount(invitation, { expiresAt: "2026-11-02T10:00:00.000Z" }),
      withDiscount(invitation, {
        countdownStartsAt: "2026-11-02T10:00:00.000Z",
      }),
      withDiscount(invitation, {
        adjustment: { kind: "fixed", amount: money(1_500) },
      }),
      makeAppliedDiscount({
        id: invitationId,
        label: "Invitation discount 15%",
        adjustment: { kind: "percentage", basisPoints: 1_500 },
        subtotalBefore: 10_000,
        amount: 1_499,
      }),
      { ...invitation, subtotalAfter: money(8_400) },
      { ...invitation, amount: { ...invitation.amount, currency: "EUR" } },
    ];
    for (const application of rejected) {
      expect(compare({ previous: [], current: [application] })).toBe(false);
    }
  });

  test("rejects a new invitation whose commitment does not prove the booked customer's invitation", () => {
    const rejectedCommitments = [
      makeCommitment([]),
      makeCommitment([withDiscount(invitation, { label: "Other" })]),
      makeCommitment(
        [invitation],
        withProvenance(invitationId, { providerReference: "" })
      ),
      makeCommitment(
        [invitation],
        withProvenance(invitationId, { details: undefined })
      ),
      makeCommitment(
        [invitation],
        withProvenance(invitationId, {
          details: {
            referralInvitation: {
              invitedDotyposCustomerId: referrerCustomerId,
              referrerDotyposCustomerId: referrerCustomerId,
              promotionCodeId: referralPromotionCodeId,
            },
          },
        })
      ),
    ];
    for (const commitment of rejectedCommitments) {
      expect(compare({ previous: [], current: [invitation], commitment })).toBe(
        false
      );
    }
    expect(compare({ previous: [], current: [invitation] })).toBe(true);
  });

  test("rejects a referrer application that appears, disappears or is duplicated", () => {
    expect(compare({ previous: [], current: [invitation, referrer] })).toBe(
      false
    );
    expect(
      compare({ previous: [previousReferrer], current: [invitation] })
    ).toBe(false);
    expect(
      compare({
        previous: [previousReferrer],
        current: [invitation, referrer, referrer],
      })
    ).toBe(false);
    expect(
      compare({
        previous: [previousReferrer, previousReferrer],
        current: [invitation, referrer],
      })
    ).toBe(false);
  });

  test("rejects a referrer recalculation the commitment does not prove for the booked customer", () => {
    const current = [invitation, referrer];
    const rejectedCommitments = [
      makeCommitment([invitation]),
      makeCommitment([invitation, withDiscount(referrer, { label: "Other" })]),
      makeCommitment(
        current,
        withProvenance(referrerId, { providerNamespace: "referral-invitation" })
      ),
      makeCommitment(
        current,
        withProvenance(referrerId, { details: undefined })
      ),
      makeCommitment(
        current,
        withProvenance(referrerId, {
          details: {
            referralInvitation: {
              invitedDotyposCustomerId: invitedCustomerId,
              referrerDotyposCustomerId: referrerCustomerId,
              promotionCodeId: referralPromotionCodeId,
            },
          },
        })
      ),
      makeCommitment(
        current,
        withReferrerDetails({ referrerDotyposCustomerId: referrerCustomerId })
      ),
      makeCommitment(current, withReferrerDetails({ eligibleInviteeCount: 0 })),
      makeCommitment(
        current,
        withReferrerDetails({ eligibleInviteeCount: 1.5 })
      ),
      makeCommitment(current, withReferrerDetails({ eligibleInviteeCount: 2 })),
    ];
    for (const commitment of rejectedCommitments) {
      expect(
        compare({ previous: [previousReferrer], current, commitment })
      ).toBe(false);
    }
    expect(compare({ previous: [previousReferrer], current })).toBe(true);
  });

  test("rejects a referrer application with another identity or a mismatched fixed amount", () => {
    expect(
      compare({
        previous: [
          withDiscount(previousReferrer, {
            expiresAt: "2026-11-02T10:00:00.000Z",
          }),
        ],
        current: [invitation, referrer],
      })
    ).toBe(false);
    const mismatchedAdjustment = withDiscount(referrer, {
      adjustment: { kind: "fixed", amount: money(1) },
    });
    expect(
      compare({
        previous: [previousReferrer],
        current: [invitation, mismatchedAdjustment],
      })
    ).toBe(false);
    const percentageReferrer = withDiscount(referrer, {
      adjustment: { kind: "percentage", basisPoints: 500 },
    });
    expect(
      compare({
        previous: [
          withDiscount(previousReferrer, {
            adjustment: { kind: "percentage", basisPoints: 500 },
          }),
        ],
        current: [invitation, percentageReferrer],
      })
    ).toBe(false);
  });

  test("rejects referral applications out of their pricing sequence", () => {
    expect(
      compare({
        previous: [],
        current: [],
        previousQuote: { ...makeQuote(10_000, []), items: [] },
        currentQuote: { ...makeQuote(10_000, []), items: [] },
      })
    ).toBe(false);
    const codeAfterInvitation = makeOrdinaryDiscount({
      label: "SUMMER10",
      subtotalBefore: invitation.subtotalAfter.value,
      amount: 1_000,
    });
    expect(
      compare({
        previous: [codeAfterInvitation],
        current: [invitation, codeAfterInvitation],
      })
    ).toBe(false);
    expect(
      compare({ previous: [ordinaryCode], current: [ordinaryCode, invitation] })
    ).toBe(false);
    const unchainedReferrer = makeReferrerDiscount({
      subtotalBefore: 10_000,
      count: 1,
    });
    expect(
      compare({
        previous: [previousReferrer],
        current: [invitation, unchainedReferrer],
      })
    ).toBe(false);
  });

  test("rejects changed items, undiscounted price or total currency", () => {
    const current = [invitation];
    const valid = makeQuote(10_000, current);
    expect(
      compare({
        previous: [],
        current,
        currentQuote: {
          ...valid,
          items: [
            { type: "cowork", tier: "open-space", amount: money(10_000) },
          ],
        },
      })
    ).toBe(false);
    expect(
      compare({
        previous: [],
        current,
        currentQuote: {
          ...valid,
          payment: { ...valid.payment, undiscountedPrice: money(10_001) },
        },
      })
    ).toBe(false);
    expect(
      compare({
        previous: [],
        current,
        currentQuote: {
          ...valid,
          payment: {
            ...valid.payment,
            expectedPrice: { ...valid.payment.expectedPrice, currency: "EUR" },
          },
        },
      })
    ).toBe(false);
  });
});
