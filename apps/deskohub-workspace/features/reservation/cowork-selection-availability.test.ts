import { describe, expect, test } from "bun:test";
import type {
  WorkspaceAvailability,
  WorkspaceAvailabilityState,
} from "@/features/reservation/workspace-availability";
import {
  evaluateCoworkSelectionAvailability,
  getCoworkWorkstationNormalization,
  getCoworkWorkstationOrigin,
} from "./cowork-selection-availability";

const date = "2099-06-10";
const otherDate = "2099-06-11";

const availability = (
  overrides: Partial<WorkspaceAvailability> = {}
): WorkspaceAvailability => ({
  from: date,
  to: date,
  date,
  unavailableDates: [],
  reservedDeskWorkstationRequiredDates: [],
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: [],
  notices: [],
  ...overrides,
});

const settled = (
  overrides: Partial<WorkspaceAvailability> = {}
): WorkspaceAvailabilityState => ({
  availability: availability(overrides),
  isError: false,
  isPending: false,
});
const pending: WorkspaceAvailabilityState = {
  availability: null,
  isError: false,
  isPending: true,
};
const failed: WorkspaceAvailabilityState = {
  availability: null,
  isError: true,
  isPending: false,
};
const idle: WorkspaceAvailabilityState = {
  availability: null,
  isError: false,
  isPending: false,
};

// No bare Reserved Desk is left on the date, but a workstation is.
const workstationRequired = {
  unavailableDates: [date],
  reservedDeskWorkstationRequiredDates: [date],
  unavailableMonitorOptions: ["2x27-qhd"],
} satisfies Partial<WorkspaceAvailability>;

describe("evaluateCoworkSelectionAvailability", () => {
  test("keeps workstation-required dates selectable only for a Reserved Desk", () => {
    const range = settled({
      from: date,
      to: otherDate,
      unavailableDates: [date, otherDate],
      reservedDeskWorkstationRequiredDates: [date],
    });
    const queries = { range, selection: idle, workstationRequirement: idle };

    expect(
      evaluateCoworkSelectionAvailability(queries, {
        date: "",
        entryTier: "reserved-desk",
      }).unavailableDates
    ).toEqual(new Set([otherDate]));
    expect(
      evaluateCoworkSelectionAvailability(queries, {
        date: "",
        entryTier: "open-space",
      }).unavailableDates
    ).toEqual(new Set([date, otherDate]));
  });

  test("disables no calendar date until the range settles", () => {
    const state = evaluateCoworkSelectionAvailability(
      { range: pending, selection: idle, workstationRequirement: idle },
      { date: "", entryTier: "open-space" }
    );

    expect(state.unavailableDates.size).toBe(0);
    expect(state.checkout).toEqual({
      isError: false,
      isPending: true,
      unavailable: undefined,
    });
  });

  test("takes unavailable tiers from the selected date, else from the range", () => {
    const range = settled({ unavailableCoworkTiers: ["open-space"] });
    const selection = settled({ unavailableCoworkTiers: ["reserved-desk"] });

    expect(
      evaluateCoworkSelectionAvailability(
        { range, selection, workstationRequirement: selection },
        { date, entryTier: "open-space" }
      ).unavailableTiers
    ).toEqual(new Set(["reserved-desk"]));
    expect(
      evaluateCoworkSelectionAvailability(
        { range, selection: pending, workstationRequirement: pending },
        { date, entryTier: "open-space" }
      ).unavailableTiers
    ).toEqual(new Set(["open-space"]));
  });

  test("shows only the selected date's notices", () => {
    const notice = { date, startsAt: "09:00", endsAt: "12:00" };
    const state = evaluateCoworkSelectionAvailability(
      {
        range: settled(),
        selection: settled({
          notices: [notice, { ...notice, date: otherDate }],
        }),
        workstationRequirement: idle,
      },
      { date, entryTier: "open-space" }
    );

    expect(state.selectedDateNotices).toEqual([notice]);
  });

  test.each([
    [
      "an unavailable tier",
      { unavailableCoworkTiers: ["open-space" as const] },
    ],
    ["an unavailable date", { unavailableDates: [date] }],
    [
      "a date that only a Reserved Desk with a workstation may take",
      workstationRequired,
    ],
  ])("rules out an Open Space for %s", (_, overrides) => {
    const state = evaluateCoworkSelectionAvailability(
      {
        range: settled(),
        selection: settled(overrides),
        workstationRequirement: idle,
      },
      { date, entryTier: "open-space" }
    );

    expect(state.checkout).toEqual({
      isError: false,
      isPending: false,
      unavailable: { kind: "cowork", entryTier: "open-space" },
    });
  });

  test("rules out a monitor option the workstation requirement reports unavailable", () => {
    const state = evaluateCoworkSelectionAvailability(
      {
        range: settled(),
        // The selected offer itself is reported available.
        selection: settled(),
        workstationRequirement: settled({
          unavailableMonitorOptions: ["2x32-qhd"],
        }),
      },
      { date, entryTier: "reserved-desk", monitorOption: "2x32-qhd" }
    );

    expect(state.workstation.isSelectedMonitorUnavailable).toBe(true);
    expect(state.checkout.unavailable).toEqual({
      kind: "cowork",
      entryTier: "reserved-desk",
    });
  });

  test("requires the first available monitor option when no bare Reserved Desk is left", () => {
    const state = evaluateCoworkSelectionAvailability(
      {
        range: settled(),
        selection: settled(workstationRequired),
        workstationRequirement: settled(workstationRequired),
      },
      { date, entryTier: "reserved-desk" }
    );

    expect(state.workstation).toEqual({
      settled: true,
      unavailableMonitorOptions: new Set(["2x27-qhd"]),
      requiredMonitorOption: "2x32-qhd",
      isSelectedMonitorUnavailable: false,
      normalizable: true,
    });
    // The date stays bookable, but checkout waits for the workstation.
    expect(state.checkout).toEqual({
      isError: false,
      isPending: true,
      unavailable: undefined,
    });
  });

  test("keeps checkout pending while a required workstation's choice is unavailable", () => {
    const queries = {
      range: settled(),
      selection: settled(workstationRequired),
      workstationRequirement: settled(workstationRequired),
    };

    expect(
      evaluateCoworkSelectionAvailability(queries, {
        date,
        entryTier: "reserved-desk",
        monitorOption: "2x27-qhd",
      }).checkout.isPending
    ).toBe(true);
    expect(
      evaluateCoworkSelectionAvailability(queries, {
        date,
        entryTier: "reserved-desk",
        monitorOption: "2x27-4k",
      }).checkout
    ).toEqual({ isError: false, isPending: false, unavailable: undefined });
  });

  test("requires no workstation until the requirement settles, nor for another date", () => {
    const whilePending = evaluateCoworkSelectionAvailability(
      {
        range: settled(),
        selection: settled(workstationRequired),
        workstationRequirement: pending,
      },
      { date, entryTier: "reserved-desk" }
    );
    const otherDay = evaluateCoworkSelectionAvailability(
      {
        range: settled(),
        selection: settled(workstationRequired),
        workstationRequirement: settled(workstationRequired),
      },
      { date: otherDate, entryTier: "reserved-desk" }
    );

    expect(whilePending.workstation).toMatchObject({
      settled: false,
      requiredMonitorOption: undefined,
      normalizable: false,
    });
    expect(whilePending.checkout.isPending).toBe(true);
    expect(otherDay.workstation.requiredMonitorOption).toBeUndefined();
  });

  test("normalizes a workstation only for a Reserved Desk whose selected-date queries both settled", () => {
    const normalizable = (
      entryTier: "open-space" | "reserved-desk",
      selection: WorkspaceAvailabilityState
    ) =>
      evaluateCoworkSelectionAvailability(
        {
          range: settled(),
          selection,
          workstationRequirement: settled(),
        },
        { date, entryTier }
      ).workstation.normalizable;

    expect(normalizable("reserved-desk", settled())).toBe(true);
    expect(normalizable("reserved-desk", pending)).toBe(false);
    expect(normalizable("open-space", settled())).toBe(false);
  });

  test("reports an availability error only once neither selected-date query is pending", () => {
    const evaluate = (
      selection: WorkspaceAvailabilityState,
      workstationRequirement: WorkspaceAvailabilityState,
      range: WorkspaceAvailabilityState = settled()
    ) =>
      evaluateCoworkSelectionAvailability(
        { range, selection, workstationRequirement },
        { date, entryTier: "reserved-desk" }
      ).checkout;

    expect(evaluate(failed, settled())).toEqual({
      isError: true,
      isPending: false,
      unavailable: undefined,
    });
    expect(evaluate(settled(), failed).isError).toBe(true);
    expect(evaluate(failed, pending)).toMatchObject({
      isError: false,
      isPending: true,
    });
    // A pending calendar range holds checkout but doesn't hide the error.
    expect(evaluate(failed, settled(), pending)).toEqual({
      isError: true,
      isPending: true,
      unavailable: undefined,
    });
  });
});

describe("getCoworkWorkstationNormalization", () => {
  const required = {
    normalizable: true,
    requiredMonitorOption: "2x32-qhd",
    isSelectedMonitorUnavailable: false,
  } as const;
  const notRequired = {
    normalizable: true,
    requiredMonitorOption: undefined,
    isSelectedMonitorUnavailable: false,
  } as const;

  test("waits for settled Reserved Desk availability", () => {
    expect(
      getCoworkWorkstationNormalization(
        { ...required, normalizable: false },
        { origin: "none" }
      )
    ).toBeUndefined();
    expect(
      getCoworkWorkstationNormalization(
        { ...notRequired, normalizable: false },
        { monitorOption: "2x27-qhd", origin: "auto-added" }
      )
    ).toBeUndefined();
  });

  test("adds the required workstation as auto-added", () => {
    expect(
      getCoworkWorkstationNormalization(required, { origin: "none" })
    ).toEqual({ monitorOption: "2x32-qhd", origin: "auto-added" });
  });

  test.each(["auto-added", "customer-selected"] as const)(
    "replaces an unavailable %s choice and keeps its origin",
    (origin) => {
      expect(
        getCoworkWorkstationNormalization(
          { ...required, isSelectedMonitorUnavailable: true },
          { monitorOption: "2x27-qhd", origin }
        )
      ).toEqual({ monitorOption: "2x32-qhd", origin });
    }
  );

  test("keeps an available choice while a workstation is required", () => {
    expect(
      getCoworkWorkstationNormalization(required, {
        monitorOption: "2x27-4k",
        origin: "customer-selected",
      })
    ).toBeUndefined();
  });

  test("removes only an auto-added workstation once none is required", () => {
    expect(
      getCoworkWorkstationNormalization(notRequired, {
        monitorOption: "2x32-qhd",
        origin: "auto-added",
      })
    ).toEqual({ monitorOption: undefined, origin: "none" });
    expect(
      getCoworkWorkstationNormalization(notRequired, {
        monitorOption: "2x32-qhd",
        origin: "customer-selected",
      })
    ).toBeUndefined();
    expect(
      getCoworkWorkstationNormalization(notRequired, { origin: "none" })
    ).toBeUndefined();
  });
});

describe("getCoworkWorkstationOrigin", () => {
  test("names an auto-added workstation before the selected value", () => {
    expect(
      getCoworkWorkstationOrigin({ autoAdded: true, monitorOption: "2x27-qhd" })
    ).toBe("auto-added");
    // A form value cleared elsewhere still carries the auto-added mark, so
    // normalization resets it.
    expect(
      getCoworkWorkstationOrigin({ autoAdded: true, monitorOption: undefined })
    ).toBe("auto-added");
    expect(
      getCoworkWorkstationOrigin({
        autoAdded: false,
        monitorOption: "2x27-qhd",
      })
    ).toBe("customer-selected");
    expect(
      getCoworkWorkstationOrigin({ autoAdded: false, monitorOption: "" })
    ).toBe("none");
  });
});
