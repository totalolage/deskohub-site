import { describe, expect, test } from "bun:test";
import { currencyCZK } from "./workspace-money";

describe("currencyCZK", () => {
  test("constructs CZK money from an integer minor-unit value", () => {
    expect(currencyCZK(47_500)).toEqual({
      value: 47_500,
      exponent: 2,
      currency: "CZK",
    });
  });
});
