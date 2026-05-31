import { describe, expect, test } from "bun:test";
import {
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
} from "./product-catalog";

describe("workspace product catalog", () => {
  test("exposes static tier-card prices explicitly", () => {
    expect(getWorkspaceProductByTier("basic-day-pass").price.value).toBe(
      35_000
    );
    expect(getWorkspaceProductByTier("cowork-plus").price.value).toBe(49_000);
    expect(getWorkspaceProductByTier("profi-workstation").price.value).toBe(
      55_000
    );
  });

  test("uses the shared coffee line price contract", () => {
    expect(getWorkspaceProductCoffeeLinePriceForTier("basic-day-pass")).toEqual(
      {
        value: 5000,
        exponent: 2,
        currency: "CZK",
      }
    );
    expect(getWorkspaceProductCoffeeLinePriceForTier("cowork-plus")).toEqual({
      value: 0,
      exponent: 2,
      currency: "CZK",
    });
    expect(
      getWorkspaceProductCoffeeLinePriceForTier("profi-workstation")
    ).toEqual({
      value: 0,
      exponent: 2,
      currency: "CZK",
    });
  });
});
