import { describe, expect, test } from "bun:test";
import type { WorkspaceProductMonitorOption } from "@/features/checkout/product-catalog";
import {
  getReservedDeskWorkstationNormalization,
  isReservedDeskSelectionCurrent,
} from "./use-cowork-addon-normalization";

const noUnavailableMonitors = new Set<WorkspaceProductMonitorOption>();

describe("getReservedDeskWorkstationNormalization", () => {
  test("adds the first available monitor when the day requires a workstation", () => {
    expect(
      getReservedDeskWorkstationNormalization({
        autoAdded: false,
        firstAvailableMonitorOption: "2x32-qhd",
        isRequired: true,
        monitorOption: undefined,
        unavailableMonitorOptions: new Set(["2x27-qhd"]),
      })
    ).toEqual({ autoAdded: true, monitorOption: "2x32-qhd" });
  });

  test("replaces an unavailable monitor and keeps who added the workstation", () => {
    for (const autoAdded of [false, true]) {
      expect(
        getReservedDeskWorkstationNormalization({
          autoAdded,
          firstAvailableMonitorOption: "2x32-qhd",
          isRequired: true,
          monitorOption: "2x27-qhd",
          unavailableMonitorOptions: new Set(["2x27-qhd"]),
        })
      ).toEqual({ autoAdded, monitorOption: "2x32-qhd" });
    }
  });

  test("keeps an available monitor the day requires", () => {
    expect(
      getReservedDeskWorkstationNormalization({
        autoAdded: false,
        firstAvailableMonitorOption: "2x27-qhd",
        isRequired: true,
        monitorOption: "2x32-4k",
        unavailableMonitorOptions: noUnavailableMonitors,
      })
    ).toBeUndefined();
  });

  test("removes only a workstation the form added once the requirement lifts", () => {
    expect(
      getReservedDeskWorkstationNormalization({
        autoAdded: true,
        firstAvailableMonitorOption: "2x27-qhd",
        isRequired: false,
        monitorOption: "2x27-qhd",
        unavailableMonitorOptions: noUnavailableMonitors,
      })
    ).toEqual({ autoAdded: false, monitorOption: undefined });
    expect(
      getReservedDeskWorkstationNormalization({
        autoAdded: false,
        firstAvailableMonitorOption: "2x27-qhd",
        isRequired: false,
        monitorOption: "2x27-qhd",
        unavailableMonitorOptions: noUnavailableMonitors,
      })
    ).toBeUndefined();
  });
});

describe("isReservedDeskSelectionCurrent", () => {
  const selection = {
    date: "2099-08-03",
    entryTier: "reserved-desk",
    monitorOption: "2x27-qhd",
  } as const;

  test("accepts form values that still hold the watched Reserved Desk selection", () => {
    expect(isReservedDeskSelectionCurrent({ ...selection }, selection)).toBe(
      true
    );
  });

  test("rejects another tier or form values the customer already changed", () => {
    const openSpace = { ...selection, entryTier: "open-space" } as const;

    expect(isReservedDeskSelectionCurrent(openSpace, openSpace)).toBe(false);
    expect(
      isReservedDeskSelectionCurrent(
        { ...selection, date: "2099-08-04" },
        selection
      )
    ).toBe(false);
    expect(
      isReservedDeskSelectionCurrent(
        { ...selection, monitorOption: undefined },
        selection
      )
    ).toBe(false);
  });
});
