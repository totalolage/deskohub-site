import { describe, expect, test } from "bun:test";
import {
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  workspaceProductMonitorOptions,
  workspaceProductMonitorOptionTableTags,
} from "./product-catalog";

describe("workspace product catalog", () => {
  test("exposes static tier-card prices explicitly", () => {
    expect(getWorkspaceProductByTier("basic").price.value).toBe(35_000);
    expect(getWorkspaceProductByTier("plus").price.value).toBe(49_000);
    expect(getWorkspaceProductByTier("profi").price.value).toBe(55_000);
  });

  test("uses the shared coffee line price contract", () => {
    expect(getWorkspaceProductCoffeeLinePriceForTier("basic")).toEqual({
      value: 5000,
      exponent: 2,
      currency: "CZK",
    });
    expect(getWorkspaceProductCoffeeLinePriceForTier("plus")).toEqual({
      value: 0,
      exponent: 2,
      currency: "CZK",
    });
    expect(getWorkspaceProductCoffeeLinePriceForTier("profi")).toEqual({
      value: 0,
      exponent: 2,
      currency: "CZK",
    });
  });

  test("maps every monitor option to complete Dotypos table tags", () => {
    expect(Object.keys(workspaceProductMonitorOptionTableTags).sort()).toEqual(
      [...workspaceProductMonitorOptions].sort()
    );

    for (const monitorOption of workspaceProductMonitorOptions) {
      expect(
        workspaceProductMonitorOptionTableTags[monitorOption]
      ).toHaveLength(3);
      expect(workspaceProductMonitorOptionTableTags[monitorOption]).toEqual(
        expect.arrayContaining([
          "monitor:count:2",
          expect.stringMatching(/^monitor:size:(27|32)$/),
          expect.stringMatching(/^monitor:resolution:(qhd|4k)$/),
        ])
      );
    }
  });
});
