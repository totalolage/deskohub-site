import { describe, expect, test } from "bun:test";
import { isPhoneRegion } from "@deskohub/phone-number";
import { locales } from "./paraglide/runtime.js";
import { defaultPhoneRegion } from "./phone-region";

describe("defaultPhoneRegion", () => {
  test.each(locales)(
    "names a region with a numbering plan for %s",
    (locale) => {
      expect(isPhoneRegion(defaultPhoneRegion(locale))).toBe(true);
    }
  );

  // Owner decision D22: each locale reads a national number in its visitors'
  // region; English serves the Czech venue's guests, so it reads Czech.
  test.each([
    ["cs-CZ", "CZ"],
    ["en-US", "CZ"],
    ["de-DE", "DE"],
    ["uk-UA", "UA"],
    ["sk-SK", "SK"],
    ["vi-VN", "VN"],
    ["hi-IN", "IN"],
  ] as const)("reads a national number in %s as %s", (locale, region) => {
    expect(defaultPhoneRegion(locale)).toBe(region);
  });
});
