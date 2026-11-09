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
});
