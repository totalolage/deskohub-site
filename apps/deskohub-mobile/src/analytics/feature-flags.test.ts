import { describe, expect, test } from "bun:test";
import { resolveFeatureFlagEnabled } from "./feature-flags";

describe("resolveFeatureFlagEnabled", () => {
  test("gives the fallback while there is no value", () => {
    expect(resolveFeatureFlagEnabled(undefined, true)).toBe(true);
    expect(resolveFeatureFlagEnabled(undefined, false)).toBe(false);
  });

  test("uses a loaded boolean over the fallback", () => {
    expect(resolveFeatureFlagEnabled(false, true)).toBe(false);
    expect(resolveFeatureFlagEnabled(true, false)).toBe(true);
  });

  test("treats a variant as on", () => {
    expect(resolveFeatureFlagEnabled("test", false)).toBe(true);
  });
});
