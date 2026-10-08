import { expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { type AppliedDiscount, discountIdSchema } from "@/features/discounts";
import { getReferralInvitationDiscountId } from "@/features/referrals/discount-identifiers";
import {
  addCheckoutReferralAppliedMarker,
  hasCheckoutReferralAppliedNotice,
} from "./checkout-referral-notice";

const customerId = DotyposCustomerIdSchema.make("referral-notice-customer");
const invitationDiscount: AppliedDiscount = {
  amount: { currency: "CZK", exponent: 2, value: 1500 },
  discount: {
    adjustment: { basisPoints: 1500, kind: "percentage" },
    id: getReferralInvitationDiscountId(customerId),
    label: "First booking referral discount",
  },
  subtotalAfter: { currency: "CZK", exponent: 2, value: 8500 },
  subtotalBefore: { currency: "CZK", exponent: 2, value: 10_000 },
};

test("adds the fixed referral marker only to a localized signed pay URL", () => {
  expect(
    addCheckoutReferralAppliedMarker(
      "/en-US/checkout/pay?payState=signed-token&orderId=reservation-id",
      "en-US"
    )
  ).toBe(
    "/en-US/checkout/pay?payState=signed-token&orderId=reservation-id&referralApplied=1"
  );
  expect(
    addCheckoutReferralAppliedMarker(
      "https://elsewhere.example/en-US/checkout/pay?payState=signed-token",
      "en-US"
    )
  ).toBeUndefined();
});

test("requires one exact marker and this customer's signed 15% invitation discount", () => {
  expect(
    hasCheckoutReferralAppliedNotice({
      marker: "1",
      discounts: [invitationDiscount],
      dotyposCustomerId: customerId,
    })
  ).toBe(true);
  expect(
    hasCheckoutReferralAppliedNotice({
      marker: ["1"],
      discounts: [invitationDiscount],
      dotyposCustomerId: customerId,
    })
  ).toBe(false);
  expect(
    hasCheckoutReferralAppliedNotice({
      marker: "true",
      discounts: [invitationDiscount],
      dotyposCustomerId: customerId,
    })
  ).toBe(false);
  expect(
    hasCheckoutReferralAppliedNotice({
      marker: "1",
      discounts: [],
      dotyposCustomerId: customerId,
    })
  ).toBe(false);

  const ordinaryDiscount = {
    ...invitationDiscount,
    discount: {
      ...invitationDiscount.discount,
      id: discountIdSchema.make("ordinary-code-discount"),
    },
  };
  expect(
    hasCheckoutReferralAppliedNotice({
      marker: "1",
      discounts: [ordinaryDiscount],
      dotyposCustomerId: customerId,
    })
  ).toBe(false);
});
