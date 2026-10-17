import { describe, expect, test } from "bun:test";
import { isMatchingSecret } from "./secret-comparison";

describe("isMatchingSecret", () => {
  test("accepts only the exact configured secret", () => {
    const configured = "synthetic-secret-0123456789abcdef";

    expect(isMatchingSecret(configured, configured)).toBe(true);
    expect(isMatchingSecret(`${configured}x`, configured)).toBe(false);
    expect(isMatchingSecret(configured.slice(0, -1), configured)).toBe(false);
    expect(isMatchingSecret("", configured)).toBe(false);
  });
});
