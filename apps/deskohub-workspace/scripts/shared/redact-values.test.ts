import { describe, expect, test } from "bun:test";
import { redactValues } from "./redact-values";

describe("redactValues", () => {
  test("replaces all occurrences, longest values first, and ignores empty values", () => {
    expect(
      redactValues("abcdef abc abcdef", ["", "abc", "abcdef", "abc"])
    ).toBe("[REDACTED] [REDACTED] [REDACTED]");
  });
});
