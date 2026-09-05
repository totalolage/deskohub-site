import { describe, expect, test } from "bun:test";
import { escapeRegExp } from "./escape-regexp";

describe("escapeRegExp", () => {
  test("escapes regex metacharacters for literal anchored patterns", () => {
    const value = [".*+?^", "$", "{}", "()|[]", "\\"].join("");
    const pattern = new RegExp(`^${escapeRegExp(value)}$`);

    expect(pattern.test(value)).toBe(true);
    expect(pattern.test(`prefix${value}`)).toBe(false);
    expect(pattern.test(`${value}suffix`)).toBe(false);
  });

  test("leaves ordinary content unchanged", () => {
    const value = "ordinary content 123";

    expect(escapeRegExp(value)).toBe(value);
  });
});
