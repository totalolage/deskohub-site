import { describe, expect, test } from "bun:test";
import { parseReferralCode } from "./client";

describe("referral code client contract", () => {
  test("accepts the canonical shared promotion-code fixture", () => {
    expect(parseReferralCode("RFL12345")).toBe("RFL12345");
  });

  test.each([
    "rfl12345",
    " RFL12345",
    "RFL12345 ",
    "RF",
    "REFERRAL CODE",
    "RFL12345?next=/account",
    12345,
    null,
  ])("rejects noncanonical referral input %p", (value) => {
    expect(parseReferralCode(value)).toBeUndefined();
  });
});
