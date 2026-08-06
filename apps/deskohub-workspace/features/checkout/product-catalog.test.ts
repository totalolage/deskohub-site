import { describe, expect, test } from "bun:test";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import {
  getWorkspaceMeetingRoomPriceForDuration,
  getWorkspaceOfficePrice,
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  isWorkspaceProductTier,
  workspaceCoworkProductCatalog,
  workspaceMeetingRoomCatalog,
  workspaceMeetingRoomProductsByDurationKey,
  workspaceProductCoffeePrice,
  workspaceProductMonitorOptions,
  workspaceProductMonitorOptionTableTags,
} from "./product-catalog";
import { getWorkspaceMeetingRoomDurationTitle } from "./product-catalog.i18n";

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
    expect(isWorkspaceProductTier("basic")).toBe(true);
    expect(isWorkspaceProductTier("toString")).toBe(false);
  });

  test("exposes approved meeting room duration prices", () => {
    expect(workspaceMeetingRoomCatalog.map(({ duration }) => duration)).toEqual(
      [
        { unit: "hour", amount: 1 },
        { unit: "hour", amount: 4 },
        { unit: "day", amount: 1 },
      ]
    );
    expect(
      getWorkspaceMeetingRoomPriceForDuration({ unit: "hour", amount: 1 })
    ).toEqual({
      value: 47_500,
      exponent: 2,
      currency: "CZK",
    });
    expect(
      getWorkspaceMeetingRoomPriceForDuration({ unit: "hour", amount: 4 })
    ).toEqual({
      value: 155_000,
      exponent: 2,
      currency: "CZK",
    });
    expect(
      getWorkspaceMeetingRoomPriceForDuration({ unit: "day", amount: 1 })
    ).toEqual({
      value: 232_000,
      exponent: 2,
      currency: "CZK",
    });
  });

  test("prices the office base and additional people per calendar day", () => {
    expect(
      getWorkspaceOfficePrice({ additionalGuests: 0, dayCount: 1 })
    ).toEqual({ value: 53_000, exponent: 2, currency: "CZK" });
    expect(
      getWorkspaceOfficePrice({ additionalGuests: 2, dayCount: 2 })
    ).toEqual({ value: 232_000, exponent: 2, currency: "CZK" });
  });

  test("keeps duration keys aligned and catalog prices in CZK", () => {
    expect(Object.keys(workspaceMeetingRoomProductsByDurationKey)).toEqual(
      workspaceMeetingRoomCatalog.map(({ duration }) =>
        getMeetingRoomReservationDurationKey(duration)
      )
    );

    const prices = [
      ...workspaceCoworkProductCatalog.map(({ price }) => price),
      ...workspaceMeetingRoomCatalog.map(({ price }) => price),
      workspaceProductCoffeePrice,
    ];

    for (const price of prices) {
      expect(price).toMatchObject({
        currency: "CZK",
        exponent: 2,
      });
    }
  });

  test("pluralizes meeting room duration titles by locale", () => {
    expect(
      getWorkspaceMeetingRoomDurationTitle({ unit: "hour", amount: 1 }, "en-US")
    ).toBe("Meeting room - 1 hour");
    expect(
      getWorkspaceMeetingRoomDurationTitle({ unit: "hour", amount: 4 }, "en-US")
    ).toBe("Meeting room - 4 hours");
    expect(
      getWorkspaceMeetingRoomDurationTitle({ unit: "day", amount: 1 }, "en-US")
    ).toBe("Meeting room - whole day");
    expect(
      getWorkspaceMeetingRoomDurationTitle({ unit: "hour", amount: 1 }, "cs-CZ")
    ).toBe("Zasedací místnost - 1 hodina");
    expect(
      getWorkspaceMeetingRoomDurationTitle({ unit: "hour", amount: 4 }, "cs-CZ")
    ).toBe("Zasedací místnost - 4 hodiny");
    expect(
      getWorkspaceMeetingRoomDurationTitle({ unit: "day", amount: 1 }, "cs-CZ")
    ).toBe("Zasedací místnost - celý den");
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
