import { describe, expect, test } from "bun:test";
import type { WorkspaceProductMonitorOption } from "@/features/checkout/product-catalog";
import { getAllowedMonitorOptionsForCoworkTier } from "@/features/reservation/cowork-reservation";
import {
  getCoworkAvailabilityQueries,
  type WorkspaceAvailability,
} from "@/features/reservation/workspace-availability";
import {
  getCoworkCalendarUnavailableDates,
  getCoworkWorkstationRequirement,
  isCoworkAvailabilityUnconfirmed,
  isCoworkSelectionUnavailable,
} from "./use-cowork-selection-availability";

const date = "2099-08-03";
const workstationDate = "2099-08-04";

const availability = (
  overrides: Partial<WorkspaceAvailability> = {}
): WorkspaceAvailability => ({
  date,
  from: date,
  to: workstationDate,
  unavailableDates: [],
  reservedDeskWorkstationRequiredDates: [],
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: [],
  notices: [],
  ...overrides,
});

const noUnavailableMonitors = new Set<WorkspaceProductMonitorOption>();

describe("getCoworkCalendarUnavailableDates", () => {
  const range = availability({
    unavailableDates: [date, workstationDate],
    reservedDeskWorkstationRequiredDates: [workstationDate],
  });

  test("keeps a Reserved Desk bookable on days that require a workstation", () => {
    expect([
      ...getCoworkCalendarUnavailableDates(range, "reserved-desk"),
    ]).toEqual([date]);
    expect([...getCoworkCalendarUnavailableDates(range, "open-space")]).toEqual(
      [date, workstationDate]
    );
  });

  test("disables no date before the range settles", () => {
    expect(getCoworkCalendarUnavailableDates(null, "open-space").size).toBe(0);
  });
});

describe("getCoworkWorkstationRequirement", () => {
  const [firstMonitor, secondMonitor] =
    getAllowedMonitorOptionsForCoworkTier("reserved-desk");
  const requirementAvailability = availability({
    date: workstationDate,
    reservedDeskWorkstationRequiredDates: [workstationDate],
  });

  test("requires the first available monitor on a workstation day", () => {
    const unavailableMonitorOptions = new Set([firstMonitor]);

    expect(
      getCoworkWorkstationRequirement({
        requirementAvailability,
        selection: { date: workstationDate, entryTier: "reserved-desk" },
        unavailableMonitorOptions,
      })
    ).toEqual({
      firstAvailableMonitorOption: secondMonitor,
      isRequired: true,
      isNormalizationPending: true,
    });
    expect(
      getCoworkWorkstationRequirement({
        requirementAvailability,
        selection: {
          date: workstationDate,
          entryTier: "reserved-desk",
          monitorOption: secondMonitor,
        },
        unavailableMonitorOptions,
      }).isNormalizationPending
    ).toBe(false);
  });

  test("requires no workstation when every monitor is taken or the requirement is unsettled", () => {
    expect(
      getCoworkWorkstationRequirement({
        requirementAvailability,
        selection: { date: workstationDate, entryTier: "reserved-desk" },
        unavailableMonitorOptions: new Set(
          getAllowedMonitorOptionsForCoworkTier("reserved-desk")
        ),
      }).isRequired
    ).toBe(false);
    expect(
      getCoworkWorkstationRequirement({
        requirementAvailability: null,
        selection: { date: workstationDate, entryTier: "reserved-desk" },
        unavailableMonitorOptions: noUnavailableMonitors,
      }).isRequired
    ).toBe(false);
  });
});

describe("isCoworkSelectionUnavailable", () => {
  const selection = { date, entryTier: "open-space" } as const;

  test("rules out an unavailable tier, monitor, or date", () => {
    expect(
      isCoworkSelectionUnavailable({
        availability: availability({ unavailableCoworkTiers: ["open-space"] }),
        selection,
        unavailableMonitorOptions: noUnavailableMonitors,
      })
    ).toBe(true);
    expect(
      isCoworkSelectionUnavailable({
        availability: null,
        selection: {
          date,
          entryTier: "reserved-desk",
          monitorOption: "2x27-qhd",
        },
        unavailableMonitorOptions: new Set(["2x27-qhd"]),
      })
    ).toBe(true);
    expect(
      isCoworkSelectionUnavailable({
        availability: availability({ unavailableDates: [date] }),
        selection,
        unavailableMonitorOptions: noUnavailableMonitors,
      })
    ).toBe(true);
  });

  test("allows the selection before availability settles or when it is free", () => {
    for (const settled of [null, availability()]) {
      expect(
        isCoworkSelectionUnavailable({
          availability: settled,
          selection,
          unavailableMonitorOptions: noUnavailableMonitors,
        })
      ).toBe(false);
    }
  });
});

describe("isCoworkAvailabilityUnconfirmed", () => {
  const queries = getCoworkAvailabilityQueries({
    date,
    entryTier: "reserved-desk",
    today: date,
  });

  test("flags an unsettled selection only once nothing is loading", () => {
    const unsettled = {
      date,
      queries,
      requirementAvailability: null,
      selectionAvailability: null,
    };

    expect(
      isCoworkAvailabilityUnconfirmed({ ...unsettled, isPending: false })
    ).toBe(true);
    expect(
      isCoworkAvailabilityUnconfirmed({ ...unsettled, isPending: true })
    ).toBe(false);
  });

  test("confirms availability once both selection queries settle", () => {
    expect(
      isCoworkAvailabilityUnconfirmed({
        date,
        isPending: false,
        queries,
        requirementAvailability: availability(),
        selectionAvailability: availability(),
      })
    ).toBe(false);
  });
});
