import { describe, expect, test } from "bun:test";
import {
  EMAIL_TEST_DOMAIN,
  isTestEmailAddress,
  resendSimulatorAddress,
  testEmailAddress,
} from "./test-email-address";

describe("isTestEmailAddress", () => {
  test("accepts any recipient on the test domain, in any case", () => {
    expect(isTestEmailAddress(testEmailAddress("synthetic"))).toBe(true);
    expect(
      isTestEmailAddress(testEmailAddress("delivered+run-1-a").toUpperCase())
    ).toBe(true);
  });

  test("rejects other domains and lookalikes of the test domain", () => {
    expect(isTestEmailAddress(resendSimulatorAddress("delivered"))).toBe(false);
    expect(isTestEmailAddress(`${testEmailAddress("synthetic")}.org`)).toBe(
      false
    );
    expect(isTestEmailAddress(`sub.${EMAIL_TEST_DOMAIN}`)).toBe(false);
    expect(isTestEmailAddress(EMAIL_TEST_DOMAIN)).toBe(false);
    expect(isTestEmailAddress("")).toBe(false);
  });
});
