import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";

describe("parseMarketingConsent", () => {
  test("parses valid consent filter values", async () => {
    const { parseMarketingConsent } = await import("./page-data.server");
    expect(parseMarketingConsent("granted")).toBe("granted");
    expect(parseMarketingConsent("withdrawn")).toBe("withdrawn");
    expect(parseMarketingConsent("never")).toBe("never");
  });

  test("defaults invalid, garbage, and empty values to All", async () => {
    const { parseMarketingConsent } = await import("./page-data.server");
    expect(parseMarketingConsent(undefined)).toBeUndefined();
    expect(parseMarketingConsent("")).toBeUndefined();
    expect(parseMarketingConsent("all")).toBeUndefined();
    expect(parseMarketingConsent("garbage")).toBeUndefined();
    expect(parseMarketingConsent("GRANTED")).toBeUndefined();
  });
});
