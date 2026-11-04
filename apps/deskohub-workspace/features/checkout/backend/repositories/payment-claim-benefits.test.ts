import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Schema } from "effect";
import {
  type AppliedDiscount,
  type DiscountAdjustment,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { deriveOpaqueDiscountId } from "@/features/discounts/opaque-discount-id";
import { promotionCodeIdSchema } from "@/features/discounts/persistence-contracts";
import { getPromotionTiming } from "@/features/discounts/promotion-code";
import { m } from "@/features/i18n";
import { getReferralBenefitIds } from "@/features/referrals/referral-benefits";
import {
  discountAdjustmentsEqual,
  isAttributedToAnotherReferral,
  promotionTimingChanged,
  referralInvitationBenefitChanged,
  voucherCreditChanged,
  voucherPresentationChanged,
} from "./payment-claim-benefits";

const czk = (value: number) => ({ value, exponent: 2, currency: "CZK" });
const invited = "100000001" as DotyposCustomerId;
const referrer = "100000002" as DotyposCustomerId;
const promotionCodeId = promotionCodeIdSchema.make("promotion-1");

const applied = (
  discount: Partial<AppliedDiscount["discount"]>,
  amount = 5250
): AppliedDiscount => ({
  discount: {
    id: Schema.decodeUnknownSync(discountIdSchema)("discount-1"),
    label: "Discount",
    adjustment: { kind: "percentage", basisPoints: 1500 },
    ...discount,
  },
  subtotalBefore: czk(35_000),
  amount: czk(amount),
  subtotalAfter: czk(35_000 - amount),
});

describe("discountAdjustmentsEqual", () => {
  const cases: readonly [DiscountAdjustment, DiscountAdjustment, boolean][] = [
    [
      { kind: "percentage", basisPoints: 1000 },
      { kind: "percentage", basisPoints: 1000 },
      true,
    ],
    [
      { kind: "percentage", basisPoints: 1000 },
      { kind: "percentage", basisPoints: 1500 },
      false,
    ],
    [
      { kind: "fixed", amount: czk(500) },
      { kind: "fixed", amount: czk(500) },
      true,
    ],
    [
      { kind: "fixed", amount: czk(500) },
      { kind: "fixed", amount: { ...czk(500), currency: "EUR" } },
      false,
    ],
    [
      { kind: "percentage", basisPoints: 500 },
      { kind: "fixed", amount: czk(500) },
      false,
    ],
  ];

  test.each(cases)("compares %o with %o", (left, right, equal) => {
    expect(discountAdjustmentsEqual(left, right)).toBe(equal);
    expect(discountAdjustmentsEqual(right, left)).toBe(equal);
  });
});

describe("promotionTimingChanged", () => {
  const until = Temporal.Instant.from("2026-12-01T10:00:00Z");

  test("matches a discount carrying the promotion's deadline", () => {
    expect(
      promotionTimingChanged(
        getPromotionTiming(until),
        applied(getPromotionTiming(until)).discount
      )
    ).toBe(false);
    expect(
      promotionTimingChanged(getPromotionTiming(null), applied({}).discount)
    ).toBe(false);
  });

  test("differs when either the deadline or the countdown moved", () => {
    const timing = getPromotionTiming(until);
    expect(promotionTimingChanged(timing, applied({}).discount)).toBe(true);
    expect(
      promotionTimingChanged(
        timing,
        applied({ ...timing, countdownStartsAt: timing.expiresAt }).discount
      )
    ).toBe(true);
  });
});

describe("isAttributedToAnotherReferral", () => {
  const claim = {
    kind: "referral_invitation" as const,
    invitedDotyposCustomerId: invited,
    referrerDotyposCustomerId: referrer,
    promotionCodeId,
  };

  test("an unattributed customer or the same referral is not another referral", () => {
    expect(isAttributedToAnotherReferral(undefined, claim)).toBe(false);
    expect(
      isAttributedToAnotherReferral(
        { referrerDotyposCustomerId: referrer, promotionCodeId },
        claim
      )
    ).toBe(false);
  });

  test("another referrer or another code is another referral", () => {
    expect(
      isAttributedToAnotherReferral(
        { referrerDotyposCustomerId: "100000003", promotionCodeId },
        claim
      )
    ).toBe(true);
    expect(
      isAttributedToAnotherReferral(
        {
          referrerDotyposCustomerId: referrer,
          promotionCodeId: promotionCodeIdSchema.make("promotion-2"),
        },
        claim
      )
    ).toBe(true);
    expect(
      isAttributedToAnotherReferral(
        { referrerDotyposCustomerId: referrer, promotionCodeId: null },
        claim
      )
    ).toBe(true);
  });
});

describe("referralInvitationBenefitChanged", () => {
  const claim = {
    kind: "referral_invitation" as const,
    invitedDotyposCustomerId: invited,
    referrerDotyposCustomerId: referrer,
    promotionCodeId,
  };
  const invitation = (
    discount: Partial<AppliedDiscount["discount"]> = {},
    amount?: number
  ) =>
    applied(
      {
        id: getReferralBenefitIds(invited).invitation,
        label: m.checkoutSummaryItemReferralInvitationDiscount(
          {},
          { locale: "en-US" }
        ),
        ...discount,
      },
      amount
    );

  test("keeps the invitee's own positive 15% invitation", () => {
    expect(
      referralInvitationBenefitChanged({
        claim,
        application: invitation(),
        locale: "en-US",
      })
    ).toBe(false);
  });

  test.each([
    [
      "a self-referral",
      { ...claim, referrerDotyposCustomerId: invited },
      invitation(),
    ],
    [
      "another customer's invitation",
      claim,
      invitation({ id: getReferralBenefitIds(referrer).invitation }),
    ],
    ["another label", claim, invitation({ label: "Other" })],
    [
      "a fixed adjustment",
      claim,
      invitation({ adjustment: { kind: "fixed", amount: czk(5250) } }),
    ],
    [
      "another percentage",
      claim,
      invitation({ adjustment: { kind: "percentage", basisPoints: 1000 } }),
    ],
    ["a zero amount", claim, invitation({}, 0)],
  ] as const)("changes with %s", (_case, changedClaim, application) => {
    expect(
      referralInvitationBenefitChanged({
        claim: changedClaim,
        application,
        locale: "en-US",
      })
    ).toBe(true);
  });

  test("changes when the label belongs to another locale", () => {
    expect(
      referralInvitationBenefitChanged({
        claim,
        application: invitation(),
        locale: "cs-CZ",
      })
    ).toBe(true);
  });
});

describe("voucher credit and presentation", () => {
  const claim = {
    kind: "voucher" as const,
    voucherId: "voucher-1" as never,
    availableAmount: czk(10_000),
    dotyposCustomerId: invited,
  };
  const credit = (
    discount: Partial<AppliedDiscount["discount"]> = {},
    amount = 10_000
  ) =>
    applied(
      {
        id: deriveOpaqueDiscountId({
          providerNamespace: "database-voucher",
          providerReference: claim.voucherId,
        }),
        label: m.checkoutVoucherLabel({}, { locale: "en-US" }),
        adjustment: { kind: "fixed", amount: czk(10_000) },
        ...discount,
      },
      amount
    );

  test("keeps credit that still matches the voucher", () => {
    expect(
      voucherCreditChanged({
        claim,
        application: credit(),
        availableAmount: czk(10_000),
      })
    ).toBe(false);
    expect(
      voucherCreditChanged({
        claim,
        application: credit({}, 4000),
        availableAmount: czk(10_000),
      })
    ).toBe(false);
  });

  test.each([
    ["less available credit", credit(), czk(6000)],
    [
      "a percentage adjustment",
      credit({ adjustment: { kind: "percentage", basisPoints: 1000 } }),
      czk(10_000),
    ],
    [
      "another fixed amount",
      credit({ adjustment: { kind: "fixed", amount: czk(9000) } }),
      czk(10_000),
    ],
    ["an application above the credit", credit({}, 10_001), czk(10_000)],
  ] as const)("credit changes with %s", (_case, application, available) => {
    expect(
      voucherCreditChanged({ claim, application, availableAmount: available })
    ).toBe(true);
  });

  test("presentation matches the voucher's id, label and deadline", () => {
    const timing = getPromotionTiming(
      Temporal.Instant.from("2026-12-01T10:00:00Z")
    );
    expect(
      voucherPresentationChanged({
        claim,
        application: credit(timing),
        locale: "en-US",
        timing,
      })
    ).toBe(false);
    expect(
      voucherPresentationChanged({
        claim,
        application: credit({ id: getReferralBenefitIds(invited).invitation }),
        locale: "en-US",
        timing: {},
      })
    ).toBe(true);
    expect(
      voucherPresentationChanged({
        claim,
        application: credit({}),
        locale: "cs-CZ",
        timing: {},
      })
    ).toBe(true);
    expect(
      voucherPresentationChanged({
        claim,
        application: credit({}),
        locale: "en-US",
        timing,
      })
    ).toBe(true);
  });
});
