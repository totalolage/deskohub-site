import { describe, expect, test } from "bun:test";
import type { CustomerAvailability } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import {
  clampOfficeDraft,
  defaultOfficeDraft,
  maximumOfficeDayCount,
  type OfficeDraft,
  type OfficeOffering,
  officeAvailabilityQuery,
  officeEnablement,
  toOfficeSelection,
} from "./office-selection";

const money = { value: 0, exponent: 2, currency: "CZK" };

const offering: OfficeOffering = {
  family: "office",
  name: "Office",
  description: "",
  usage: "",
  price: money,
  seatPrice: money,
  maximumSeats: 6,
  maximumDurationHours: 672,
  advertisedPrice: { price: money, discount: money },
};

const today = "2026-11-07";
const now = new Date("2026-11-07T09:00:00Z");

const availability = (
  overrides: Partial<CustomerAvailability> = {}
): CustomerAvailability => ({
  from: today,
  to: "2026-12-07",
  unavailableDates: [],
  reservedDeskWorkstationRequiredDates: [],
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: [],
  notices: [],
  ...overrides,
});

const enablementOf = (
  draft: OfficeDraft,
  overrides: Partial<CustomerAvailability> = {},
  officeOffering: OfficeOffering = offering
) =>
  officeEnablement(draft, {
    now,
    offering: officeOffering,
    availability: Option.some(availability(overrides)),
  });

const blockerTags = (
  draft: OfficeDraft,
  overrides: Partial<CustomerAvailability> = {}
) => enablementOf(draft, overrides).blockers.map(({ _tag }) => _tag);

describe("defaultOfficeDraft", () => {
  test("opens on one day today with one seat", () => {
    expect(defaultOfficeDraft(today)).toEqual({
      date: today,
      dayCount: 1,
      seats: 1,
    });
  });
});

describe("toOfficeSelection", () => {
  test("ends on the last day booked, inclusive", () => {
    expect(toOfficeSelection({ date: today, dayCount: 3, seats: 2 })).toEqual({
      family: "office",
      date: today,
      endDate: "2026-11-09",
      seats: 2,
    });
    expect(toOfficeSelection(defaultOfficeDraft(today)).endDate).toBe(today);
  });
});

describe("officeAvailabilityQuery", () => {
  test("spans today through one calendar month", () => {
    expect(officeAvailabilityQuery(today)).toEqual({
      kind: "office",
      from: today,
      to: "2026-12-07",
    });
    expect(officeAvailabilityQuery("2027-01-31").to).toBe("2027-02-28");
  });
});

describe("maximumOfficeDayCount", () => {
  const limits = { maximumDurationHours: 672, unavailableDates: [] };

  test("reaches the horizon's last day when 672 hours allow it", () => {
    // 7 November to 7 December is 31 days, but 672 hours cap it at 28.
    expect(
      maximumOfficeDayCount({ ...limits, date: today, latest: "2026-12-07" })
    ).toBe(28);
    expect(
      maximumOfficeDayCount({
        ...limits,
        date: "2026-12-01",
        latest: "2026-12-07",
      })
    ).toBe(7);
  });

  test("allows only 27 days across the autumn clock change", () => {
    expect(
      maximumOfficeDayCount({
        ...limits,
        date: "2026-10-01",
        latest: "2026-11-01",
      })
    ).toBe(27);
  });

  test("allows 28 days across the spring clock change", () => {
    // 28 days with a 23-hour day are 671 hours; a 29th would be 695.
    expect(
      maximumOfficeDayCount({
        ...limits,
        date: "2026-03-15",
        latest: "2026-04-15",
      })
    ).toBe(28);
  });

  test("stops before the first unavailable day", () => {
    expect(
      maximumOfficeDayCount({
        ...limits,
        date: today,
        latest: "2026-12-07",
        unavailableDates: ["2026-11-20", "2026-11-11", "2026-11-01"],
      })
    ).toBe(4);
  });

  test("allows none from an unavailable day", () => {
    expect(
      maximumOfficeDayCount({
        ...limits,
        date: today,
        latest: "2026-12-07",
        unavailableDates: [today],
      })
    ).toBe(0);
  });
});

describe("officeEnablement", () => {
  test("offers today through one month and the office's seats", () => {
    const enablement = enablementOf(defaultOfficeDraft(today), {
      unavailableDates: ["2026-11-20"],
    });

    expect(enablement.dates).toEqual({
      earliest: today,
      latest: "2026-12-07",
      unavailable: new Set(["2026-11-20"]),
    });
    expect(enablement.maximumDayCount).toBe(13);
    expect(enablement.maximumSeats).toEqual(Option.some(6));
    expect(enablement.blockers).toEqual([]);
  });

  test("keeps the drafted seats while the capacity can't be read", () => {
    const { maximumSeats: _, ...withoutCapacity } = offering;
    const group = { date: today, dayCount: 1, seats: 4 };
    const enablement = enablementOf(group, {}, withoutCapacity);

    expect(enablement.maximumSeats).toEqual(Option.none());
    expect(enablement.blockers).toEqual([]);
    expect(clampOfficeDraft(group, enablement)).toBe(group);
  });

  test("blocks counts that aren't whole numbers", () => {
    expect(blockerTags({ date: today, dayCount: 1.5, seats: 1 })).toEqual([
      "DayCountUnavailable",
    ]);
    expect(blockerTags({ date: today, dayCount: 1, seats: 2.5 })).toEqual([
      "SeatsUnavailable",
    ]);
  });

  test("blocks an unavailable or out-of-horizon first day", () => {
    expect(
      blockerTags(defaultOfficeDraft(today), { unavailableDates: [today] })
    ).toEqual(["DateUnavailable"]);
    expect(blockerTags(defaultOfficeDraft("2026-12-08"))).toEqual([
      "DateUnavailable",
    ]);
    expect(blockerTags(defaultOfficeDraft("2026-11-06"))).toEqual([
      "DateUnavailable",
    ]);
  });

  test("blocks a stay past the first unavailable day", () => {
    const enablement = enablementOf(
      { date: today, dayCount: 5, seats: 1 },
      { unavailableDates: ["2026-11-11"] }
    );

    expect(enablement.blockers).toEqual([
      { _tag: "DayCountUnavailable", maximumDayCount: 4 },
    ]);
  });

  test("blocks more seats than the office has", () => {
    expect(blockerTags({ date: today, dayCount: 1, seats: 7 })).toEqual([
      "SeatsUnavailable",
    ]);
    expect(blockerTags({ date: today, dayCount: 1, seats: 0 })).toEqual([
      "SeatsUnavailable",
    ]);
  });

  test("waits for the horizon's availability", () => {
    const enablement = officeEnablement(defaultOfficeDraft(today), {
      now,
      offering,
      availability: Option.none(),
    });

    expect(enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "AvailabilityPending",
    ]);
  });

  test("shows the notices within the days drafted", () => {
    const notice = { date: "2026-11-08", startsAt: "", endsAt: "" };
    const enablement = enablementOf(
      { date: today, dayCount: 2, seats: 1 },
      { notices: [notice, { ...notice, date: "2026-11-09" }] }
    );

    expect(enablement.notices).toEqual([notice]);
  });
});

describe("clampOfficeDraft", () => {
  test("brings days and seats within what the first day allows", () => {
    expect(
      clampOfficeDraft(
        { date: today, dayCount: 10, seats: 9 },
        { maximumDayCount: 4, maximumSeats: Option.some(6) }
      )
    ).toEqual({ date: today, dayCount: 4, seats: 6 });
  });

  test("rounds fractional counts down to whole ones", () => {
    expect(
      clampOfficeDraft(
        { date: today, dayCount: 2.7, seats: 0.4 },
        { maximumDayCount: 4, maximumSeats: Option.some(6) }
      )
    ).toEqual({ date: today, dayCount: 2, seats: 1 });
  });

  test("keeps a draft already within bounds", () => {
    const draft = { date: today, dayCount: 3, seats: 2 };

    expect(
      clampOfficeDraft(draft, {
        maximumDayCount: 4,
        maximumSeats: Option.some(6),
      })
    ).toBe(draft);
  });

  test("keeps the day count when the first day allows none", () => {
    const draft = { date: today, dayCount: 3, seats: 2 };

    expect(
      clampOfficeDraft(draft, {
        maximumDayCount: 0,
        maximumSeats: Option.some(6),
      }).dayCount
    ).toBe(3);
  });
});
