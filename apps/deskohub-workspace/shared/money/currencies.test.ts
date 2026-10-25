import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { unitOf, workspaceCurrencyDefinitions } from "./currencies";

describe("workspace currency catalog", () => {
  test("gives each catalog currency its code and exponent as the unit", () => {
    for (const { code, exponent } of workspaceCurrencyDefinitions) {
      expect(unitOf(code)).toEqual(Option.some({ currency: code, exponent }));
    }
  });

  test("gives no unit for a code outside the catalog", () => {
    expect(Option.isNone(unitOf("ZZZ"))).toBe(true);
    expect(Option.isNone(unitOf("czk"))).toBe(true);
    expect(Option.isNone(unitOf(""))).toBe(true);
  });
});
