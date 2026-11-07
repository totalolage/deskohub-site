import { describe, expect, test } from "bun:test";
import { detectOtherPostHogSdk } from "./other-posthog-sdk";

describe("detectOtherPostHogSdk", () => {
  test("finds a posthog-js instance on the page", () => {
    expect(detectOtherPostHogSdk({ posthog: { capture: () => {} } })).toBe(
      true
    );
  });

  test("finds nothing on a page without one", () => {
    expect(detectOtherPostHogSdk({})).toBe(false);
    expect(detectOtherPostHogSdk({ posthog: undefined })).toBe(false);
    expect(detectOtherPostHogSdk({ posthog: null })).toBe(false);
  });
});
