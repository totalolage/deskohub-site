import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import { calculateDiscounts } from "@/features/discounts/calculator";
import {
  type AppliedDiscount,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { promotionCodeIdSchema } from "@/features/discounts/persistence-contracts";
import type { DiscountProvenance } from "@/features/discounts/provider";
import { m } from "@/features/i18n";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { currencyCZK } from "@/shared/money/currencies";
import {
  getReferralBenefitIds,
  listReferralBenefitIds,
  makeReferralInvitationCandidate,
  makeReferralReferrerCandidate,
  matchesReferrerFormula,
  priceReferralBenefits,
  recognizeCommittedReferralBenefit,
  recognizeReferralBenefit,
} from "./referral-benefits";

const customer = dotyposCustomerIdSchema.make("42");
const referrer = dotyposCustomerIdSchema.make("1001");
const promotionCodeId = promotionCodeIdSchema.make("referral-code-id");
const ids = getReferralBenefitIds(customer);

const invitationCandidate = makeReferralInvitationCandidate({
  dotyposCustomerId: customer,
  locale: "en-US",
  referral: { referrerDotyposCustomerId: referrer, promotionCodeId },
});

const apply = (
  discount: AppliedDiscount["discount"],
  subtotalBefore: number,
  amount: number
): AppliedDiscount => ({
  discount,
  subtotalBefore: currencyCZK(subtotalBefore),
  amount: currencyCZK(amount),
  subtotalAfter: currencyCZK(subtotalBefore - amount),
});

const referrerProvenance = (
  eligibleInviteeCount: number,
  referrerDotyposCustomerId = customer
): DiscountProvenance => ({
  providerNamespace: "referral-referrer",
  providerReference: customer,
  details: {
    referralReferrer: {
      referrerDotyposCustomerId,
      eligibleInviteeCount,
      discountPercentage: "5",
    },
  },
});

describe("referral benefit identity", () => {
  test("keeps the stored public discount IDs", () => {
    expect(ids).toEqual({
      invitation: "5kb-Qo-CUdBZ04RNrS-5TYv9B7S0PbanTMrV6J7rQf0",
      referrer: "zZ2UbFK8p3di0NoxFIYaVdErH_xC4dbukGANT5oGU8k",
    });
    expect(getReferralBenefitIds(referrer)).toEqual({
      invitation: "rTTjyEEFN7D8yYwXojgG0iYJa5qQ4_CxJFuav79CtWg",
      referrer: "4MudLowC6ZhvDjujDnhz66J8DkneyfTXX49fbYukvNA",
    });
    expect(listReferralBenefitIds(customer)).toEqual([
      ids.invitation,
      ids.referrer,
    ]);
  });

  test("keeps the invitation candidate's signed shape", () => {
    expect(JSON.stringify(invitationCandidate)).toBe(
      JSON.stringify({
        discount: {
          id: ids.invitation,
          label: m.checkoutSummaryItemReferralInvitationDiscount(
            {},
            { locale: "en-US" }
          ),
          adjustment: { kind: "percentage", basisPoints: 1_500 },
        },
        provenance: {
          providerNamespace: "referral-invitation",
          providerReference: promotionCodeId,
          details: {
            referralInvitation: {
              invitedDotyposCustomerId: customer,
              referrerDotyposCustomerId: referrer,
              promotionCodeId,
            },
          },
        },
        claim: {
          kind: "referral_invitation",
          invitedDotyposCustomerId: customer,
          referrerDotyposCustomerId: referrer,
          promotionCodeId,
        },
      })
    );
  });

  test("keeps the referrer candidate's signed shape and omits a zero benefit", () => {
    const candidate = makeReferralReferrerCandidate({
      dotyposCustomerId: customer,
      locale: "en-US",
      eligibleInviteeCount: 2,
      remainingSubtotal: currencyCZK(20_000),
    });
    expect(JSON.stringify(candidate)).toBe(
      JSON.stringify({
        discount: {
          id: ids.referrer,
          label: m.checkoutSummaryItemReferralDiscount(
            { count: "2" },
            { locale: "en-US" }
          ),
          adjustment: { kind: "fixed", amount: currencyCZK(1_950) },
        },
        provenance: {
          providerNamespace: "referral-referrer",
          providerReference: customer,
          details: {
            referralReferrer: {
              referrerDotyposCustomerId: customer,
              eligibleInviteeCount: 2,
              discountPercentage: "9.75",
            },
          },
        },
      })
    );
    expect(
      makeReferralReferrerCandidate({
        dotyposCustomerId: customer,
        locale: "en-US",
        eligibleInviteeCount: 0,
        remainingSubtotal: currencyCZK(20_000),
      })
    ).toBeUndefined();
    expect(
      makeReferralReferrerCandidate({
        dotyposCustomerId: customer,
        locale: "en-US",
        eligibleInviteeCount: 1,
        remainingSubtotal: currencyCZK(9),
      })
    ).toBeUndefined();
  });
});

describe("recognizing a presented referral benefit", () => {
  test("names the customer's invitation and whether it offers the program rate", () => {
    expect(
      recognizeReferralBenefit({
        dotyposCustomerId: customer,
        discount: invitationCandidate.discount,
      })
    ).toEqual({ kind: "invitation", offersProgramRate: true });
    expect(
      recognizeReferralBenefit({
        dotyposCustomerId: customer,
        discount: {
          ...invitationCandidate.discount,
          adjustment: { kind: "percentage", basisPoints: 1_000 },
        },
      })
    ).toEqual({ kind: "invitation", offersProgramRate: false });
  });

  test("tells the referrer benefit from another customer's benefits", () => {
    expect(
      recognizeReferralBenefit({
        dotyposCustomerId: customer,
        discount: { ...invitationCandidate.discount, id: ids.referrer },
      })
    ).toEqual({ kind: "referrer" });
    expect(
      recognizeReferralBenefit({
        dotyposCustomerId: referrer,
        discount: invitationCandidate.discount,
      })
    ).toEqual({ kind: "other" });
  });
});

describe("recognizing a committed referral benefit", () => {
  const invitation = apply(invitationCandidate.discount, 10_001, 1_500);
  const committedInvitation = {
    application: invitation,
    provenance: invitationCandidate.provenance,
  };

  test("proves the invitation from the committed snapshot", () => {
    expect(
      recognizeCommittedReferralBenefit({
        dotyposCustomerId: customer,
        application: invitation,
        committed: committedInvitation,
      })
    ).toEqual({ kind: "invitation", matchesProgram: true });
  });

  test("rejects an invitation the snapshot does not hold or name", () => {
    const unrecognized = { kind: "unrecognized" };
    expect(
      recognizeCommittedReferralBenefit({
        dotyposCustomerId: customer,
        application: invitation,
        committed: undefined,
      })
    ).toEqual(unrecognized);
    expect(
      recognizeCommittedReferralBenefit({
        dotyposCustomerId: customer,
        application: invitation,
        committed: {
          ...committedInvitation,
          application: apply(invitationCandidate.discount, 10_000, 1_500),
        },
      })
    ).toEqual(unrecognized);
    expect(
      recognizeCommittedReferralBenefit({
        dotyposCustomerId: customer,
        application: invitation,
        committed: {
          ...committedInvitation,
          provenance: {
            ...invitationCandidate.provenance,
            providerNamespace: "referral-referrer",
          },
        },
      })
    ).toEqual(unrecognized);
    expect(
      recognizeCommittedReferralBenefit({
        dotyposCustomerId: customer,
        application: invitation,
        committed: {
          ...committedInvitation,
          provenance: {
            ...invitationCandidate.provenance,
            providerReference: "",
          },
        },
      })
    ).toEqual(unrecognized);
    expect(
      recognizeCommittedReferralBenefit({
        dotyposCustomerId: customer,
        application: invitation,
        committed: {
          ...committedInvitation,
          provenance: {
            ...invitationCandidate.provenance,
            details: {
              referralInvitation: {
                invitedDotyposCustomerId: referrer,
                referrerDotyposCustomerId: customer,
                promotionCodeId,
              },
            },
          },
        },
      })
    ).toEqual(unrecognized);
  });

  test("marks an inexact or off-rate invitation as not matching the program", () => {
    for (const application of [
      apply(invitationCandidate.discount, 10_001, 1_501),
      apply(
        {
          ...invitationCandidate.discount,
          adjustment: { kind: "percentage", basisPoints: 1_000 },
        },
        10_000,
        1_000
      ),
      { ...invitation, subtotalAfter: currencyCZK(8_000) },
    ]) {
      expect(
        recognizeCommittedReferralBenefit({
          dotyposCustomerId: customer,
          application,
          committed: {
            application,
            provenance: invitationCandidate.provenance,
          },
        })
      ).toEqual({ kind: "invitation", matchesProgram: false });
    }
  });

  test("reads the committed referrer count only for the customer's own positive count", () => {
    const application = apply(
      {
        id: ids.referrer,
        label: "referrer",
        adjustment: { kind: "fixed", amount: currencyCZK(500) },
      },
      10_000,
      500
    );
    const recognize = (provenance: DiscountProvenance) =>
      recognizeCommittedReferralBenefit({
        dotyposCustomerId: customer,
        application,
        committed: { application, provenance },
      });
    expect(recognize(referrerProvenance(1))).toEqual({
      kind: "referrer",
      eligibleInviteeCount: 1,
    });
    expect(recognize(referrerProvenance(0))).toEqual({ kind: "unrecognized" });
    expect(recognize(referrerProvenance(1.5))).toEqual({
      kind: "unrecognized",
    });
    expect(recognize(referrerProvenance(1, referrer))).toEqual({
      kind: "unrecognized",
    });
    expect(
      recognize({
        ...referrerProvenance(1),
        providerNamespace: "referral-invitation",
      })
    ).toEqual({ kind: "unrecognized" });
  });

  test("checks the referrer amount against the formula on its own subtotal", () => {
    const referrerDiscount = (amount: number) => ({
      id: ids.referrer,
      label: "referrer",
      adjustment: { kind: "fixed" as const, amount: currencyCZK(amount) },
    });
    expect(
      matchesReferrerFormula(apply(referrerDiscount(1_950), 20_000, 1_950), 2)
    ).toBe(true);
    expect(
      matchesReferrerFormula(apply(referrerDiscount(1_950), 20_000, 1_950), 1)
    ).toBe(false);
    expect(
      matchesReferrerFormula(apply(referrerDiscount(2_000), 20_000, 1_950), 2)
    ).toBe(false);
  });
});

describe("pricing the referral phase", () => {
  const product = {
    kind: "cowork",
    tier: "basic",
  } satisfies WorkspaceProductIdentity;
  const ordinaryCandidate = {
    discount: {
      id: discountIdSchema.make("ordinary-discount"),
      label: "ordinary",
      adjustment: { kind: "fixed" as const, amount: currencyCZK(1_000) },
    },
    provenance: { providerNamespace: "ordinary", providerReference: "code" },
  };
  const baseQuote = Effect.runSync(
    calculateDiscounts({
      product,
      discountableSubtotal: currencyCZK(21_000),
      candidates: [ordinaryCandidate],
    })
  ).quote;
  const referrerFor = (remainingSubtotal: AppliedDiscount["amount"]) =>
    makeReferralReferrerCandidate({
      dotyposCustomerId: customer,
      locale: "en-US",
      eligibleInviteeCount: 1,
      remainingSubtotal,
    });

  test("applies the invitation, then the referrer on the subtotal it leaves", () => {
    const remainders: number[] = [];
    const priced = Effect.runSync(
      priceReferralBenefits({
        baseQuote,
        invitation: Effect.succeed(invitationCandidate),
        referrer: (remainingSubtotal) => {
          remainders.push(remainingSubtotal.value);
          return Effect.succeed(referrerFor(remainingSubtotal));
        },
      })
    );
    expect(remainders).toEqual([17_000]);
    expect(
      priced.applications.map(({ application }) => [
        application.discount.id,
        application.subtotalBefore.value,
        application.amount.value,
      ])
    ).toEqual([
      [ids.invitation, 20_000, 3_000],
      [ids.referrer, 17_000, 850],
    ]);
    // Signed quotes serialize this shape, so property order matters too.
    expect(JSON.stringify(priced.quote)).toBe(
      JSON.stringify({
        product: baseQuote.product,
        discountableSubtotal: currencyCZK(21_000),
        discounts: [
          {
            discount: ordinaryCandidate.discount,
            subtotalBefore: currencyCZK(21_000),
            amount: currencyCZK(1_000),
            subtotalAfter: currencyCZK(20_000),
          },
          {
            discount: invitationCandidate.discount,
            subtotalBefore: currencyCZK(20_000),
            amount: currencyCZK(3_000),
            subtotalAfter: currencyCZK(17_000),
          },
          {
            discount: {
              id: ids.referrer,
              label: m.checkoutSummaryItemReferralDiscount(
                { count: "1" },
                { locale: "en-US" }
              ),
              adjustment: { kind: "fixed", amount: currencyCZK(850) },
            },
            subtotalBefore: currencyCZK(17_000),
            amount: currencyCZK(850),
            subtotalAfter: currencyCZK(16_150),
          },
        ],
        totalDiscount: currencyCZK(4_850),
        discountedSubtotal: currencyCZK(16_150),
      })
    );
  });

  test("leaves the quote unchanged without referral candidates", () => {
    const priced = Effect.runSync(
      priceReferralBenefits({
        baseQuote,
        invitation: Effect.succeed(undefined),
        referrer: () => Effect.succeed(undefined),
      })
    );
    expect(priced).toEqual({ quote: baseQuote, applications: [] });
  });
});
