import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { resolveFeatureFlagOverrides } from "./feature-flag-overrides";

const warn = spyOn(console, "warn").mockImplementation(() => undefined);

afterEach(() => {
  warn.mockClear();
});

describe("resolveFeatureFlagOverrides", () => {
  test("keeps generated-contract overrides without warning", () => {
    expect(resolveFeatureFlagOverrides(undefined)).toBeUndefined();
    expect(
      resolveFeatureFlagOverrides({ discount_codes: true, office_page: false })
    ).toEqual({ discount_codes: true, office_page: false });
    expect(warn).not.toHaveBeenCalled();
  });

  test("drops keys missing from the generated contract and names only the keys", () => {
    expect(
      resolveFeatureFlagOverrides({
        discount_codes: true,
        loyalty_points: false,
        seasonal_menu: true,
      })
    ).toEqual({ discount_codes: true });
    expect(warn).toHaveBeenCalledTimes(1);

    const [message] = warn.mock.calls[0] ?? [];
    expect(message).toBe(
      "Ignoring PostHog feature flag overrides for keys missing from the generated contract: loyalty_points, seasonal_menu"
    );
    expect(String(message)).not.toContain("false");
    expect(String(message)).not.toContain("true");
    expect(String(message)).not.toContain("discount_codes");
  });

  test("drops an unknown key without validating or echoing its value", () => {
    expect(
      resolveFeatureFlagOverrides({
        discount_codes: false,
        seasonal_menu: "synthetic-variant",
      })
    ).toEqual({ discount_codes: false });
    expect(warn).toHaveBeenCalledTimes(1);

    const [message] = warn.mock.calls[0] ?? [];
    expect(String(message)).toContain("seasonal_menu");
    expect(String(message)).not.toContain("synthetic-variant");
  });
});
