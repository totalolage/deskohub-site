import { describe, expect, test } from "bun:test";
import { currencyCZK } from "@/features/checkout/workspace-money";
import {
  calculateReferrerDiscountAmount,
  formatReferrerDiscountPercentage,
} from "./referrer-discount";

describe("referrer discount arithmetic", () => {
  test("calculates the exact compounding percentage for account display", () => {
    expect(formatReferrerDiscountPercentage(0)).toBe("0");
    expect(formatReferrerDiscountPercentage(1)).toBe("5");
    expect(formatReferrerDiscountPercentage(2)).toBe("9.75");
    expect(formatReferrerDiscountPercentage(3)).toBe("14.2625");
    expect(formatReferrerDiscountPercentage(20)).toBe(
      "64.15140775914577656425895595550537109375"
    );
  });

  test("rounds the exact compounded benefit once on the remaining subtotal", () => {
    expect(
      calculateReferrerDiscountAmount({
        eligibleInviteeCount: 0,
        remainingSubtotal: currencyCZK(100),
      })
    ).toEqual(currencyCZK(0));
    expect(
      calculateReferrerDiscountAmount({
        eligibleInviteeCount: 2,
        remainingSubtotal: currencyCZK(200),
      })
    ).toEqual(currencyCZK(20));
    // Three 5% reductions rounded separately would total 15 minor units;
    // the exact combined rate is 14.2625%, rounded once to 14.
    expect(
      calculateReferrerDiscountAmount({
        eligibleInviteeCount: 3,
        remainingSubtotal: currencyCZK(100),
      })
    ).toEqual(currencyCZK(14));
    expect(
      calculateReferrerDiscountAmount({
        eligibleInviteeCount: 3,
        remainingSubtotal: currencyCZK(1_850_000),
      })
    ).toEqual(currencyCZK(263_856));
  });
});
