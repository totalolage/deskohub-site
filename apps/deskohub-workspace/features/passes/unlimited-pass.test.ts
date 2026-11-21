import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { currencyCZK } from "@/shared/money/currencies";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import { getUnlimitedPassPrice, unlimitedPassCoffeePrice } from "./pass-offer";
import {
  getUnlimitedPassEndDate,
  getUnlimitedPassWithdrawal,
  isUnlimitedPassRenewalEligible,
  unlimitedPassRequiresEarlyStart,
  unlimitedPassSelectionSchema,
} from "./unlimited-pass";

const date = plainDateStringSchema.make;

describe("Unlimited pass terms", () => {
  test("asks for early-start consent only inside the 14-day window", () => {
    const agreedOn = Temporal.PlainDate.from("2027-03-16");
    expect(unlimitedPassRequiresEarlyStart(date("2027-03-30"), agreedOn)).toBe(
      true
    );
    expect(unlimitedPassRequiresEarlyStart(date("2027-03-31"), agreedOn)).toBe(
      false
    );
  });
  test("prices the approved offers and Open Space coffee", () => {
    expect(
      getUnlimitedPassPrice({ kind: "unlimited", tier: "open-space" })
    ).toEqual(currencyCZK(349_000));
    expect(
      getUnlimitedPassPrice({ kind: "unlimited", tier: "reserved-desk" })
    ).toEqual(currencyCZK(599_000));
    expect(
      getUnlimitedPassPrice({
        kind: "unlimited",
        tier: "reserved-desk-workstation",
      })
    ).toEqual(currencyCZK(849_000));
    expect(unlimitedPassCoffeePrice).toEqual(currencyCZK(69_000));
  });

  test("uses 30 consecutive calendar dates across Prague daylight saving changes", () => {
    expect(getUnlimitedPassEndDate(date("2027-03-16"))).toBe("2027-04-15");
    expect(getUnlimitedPassEndDate(date("2027-10-16"))).toBe("2027-11-15");
  });

  test("keeps the renewal's fixed start eligible until Prague midnight", () => {
    const pass = {
      status: "withdrawn",
      validUntil: date("2027-03-28"),
    } as const;
    expect(
      isUnlimitedPassRenewalEligible(
        pass,
        Temporal.Instant.from("2027-03-28T21:59:59Z")
      )
    ).toBe(true);
    expect(
      isUnlimitedPassRenewalEligible(
        pass,
        Temporal.Instant.from("2027-03-28T22:00:00Z")
      )
    ).toBe(false);
    expect(
      isUnlimitedPassRenewalEligible(
        { ...pass, status: "void" },
        Temporal.Instant.from("2027-03-28T10:00:00Z")
      )
    ).toBe(false);
  });

  test("requires a monitor setup for workstation and accepts coffee on Open Space", () => {
    const decode = Schema.decodeUnknownSync(unlimitedPassSelectionSchema, {
      onExcessProperty: "error",
    });
    const startDate = "2027-03-16";
    expect(decode({ startDate, tier: "open-space", coffee: true })).toEqual({
      startDate,
      tier: "open-space",
      coffee: true,
    });
    expect(() =>
      decode({ startDate, tier: "reserved-desk", coffee: true })
    ).toThrow();
    expect(() =>
      decode({ startDate, tier: "reserved-desk-workstation" })
    ).toThrow();
  });

  test("refunds the full exact amount and releases every day before start", () => {
    const paid = currencyCZK(349_037);
    expect(
      getUnlimitedPassWithdrawal({
        startDate: date("2027-03-16"),
        withdrawalDate: date("2027-03-15"),
        paid,
      })
    ).toEqual({ accessEndsOn: "2027-03-16", refund: paid });
  });

  test("counts today as used and retains access until tomorrow", () => {
    expect(
      getUnlimitedPassWithdrawal({
        startDate: date("2027-03-16"),
        withdrawalDate: date("2027-03-18"),
        paid: currencyCZK(349_037),
      })
    ).toEqual({ accessEndsOn: "2027-03-19", refund: currencyCZK(314_100) });
  });

  test("never extends access or refunds used days after the period", () => {
    expect(
      getUnlimitedPassWithdrawal({
        startDate: date("2027-03-16"),
        withdrawalDate: date("2027-04-28"),
        paid: currencyCZK(349_000),
      })
    ).toEqual({ accessEndsOn: "2027-04-15", refund: currencyCZK(0) });
  });
});
