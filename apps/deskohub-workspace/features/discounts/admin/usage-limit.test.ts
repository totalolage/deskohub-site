import { describe, expect, test } from "bun:test";
import { formatDiscountUsageLimit } from "./usage-limit";

describe("formatDiscountUsageLimit", () => {
  test("groups a limit's digits for the locale", () => {
    expect(formatDiscountUsageLimit(1250, "en-US")).toBe("1,250");
    expect(formatDiscountUsageLimit(1250, "cs-CZ")).toBe("1 250");
  });

  test("reads a missing limit as unlimited", () => {
    expect(formatDiscountUsageLimit(null, "en-US")).toBe("Unlimited");
    expect(formatDiscountUsageLimit(null, "cs-CZ")).toBe("Neomezeně");
  });
});
