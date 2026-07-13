import { describe, expect, test } from "bun:test";
import {
  getWorkspaceMeetingRoomPriceForDuration,
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  workspaceCoworkProductCatalog,
  workspaceMeetingRoomDurationOptions,
  workspaceProductMonitorOptions,
  workspaceProductMonitorOptionTableTags,
} from "./product-catalog";

describe("workspace product catalog", () => {
  test("exposes static tier-card prices explicitly", () => {
    expect(getWorkspaceProductByTier("basic").price.value).toBe(35_000);
    expect(getWorkspaceProductByTier("plus").price.value).toBe(49_000);
    expect(getWorkspaceProductByTier("profi").price.value).toBe(55_000);
  });

  test("keeps cowork-only catalog consumers separate from meeting room", () => {
    expect(
      workspaceCoworkProductCatalog.map((product) => product.tier)
    ).toEqual(["basic", "plus", "profi"]);
  });

  test("exposes approved meeting room duration prices", () => {
    expect([...workspaceMeetingRoomDurationOptions]).toEqual([60, 240, 1440]);
    expect(getWorkspaceMeetingRoomPriceForDuration(60)).toEqual({
      value: 30_000,
      exponent: 2,
      currency: "CZK",
    });
    expect(getWorkspaceMeetingRoomPriceForDuration(240)).toEqual({
      value: 60_000,
      exponent: 2,
      currency: "CZK",
    });
    expect(getWorkspaceMeetingRoomPriceForDuration(1440)).toEqual({
      value: 100_000,
      exponent: 2,
      currency: "CZK",
    });
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
