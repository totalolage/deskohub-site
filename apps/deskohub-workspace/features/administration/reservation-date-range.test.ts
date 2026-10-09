import { describe, expect, test } from "bun:test";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  getAdministrationOverviewDateRanges,
  getAdministrationReservationDateRange,
  getAdministrationReservationDateShortcuts,
  getAdministrationReservationListDateRange,
  getAdministrationReservationYearToDateRange,
} from "./reservation-date-range";

describe("administration reservation date ranges", () => {
  test("normalizes inclusive range filters", () => {
    expect(
      getAdministrationReservationDateRange({
        from: "2026-08-12",
        to: "2026-08-06",
      })
    ).toEqual({ from: "2026-08-06", to: "2026-08-12" });
    expect(
      getAdministrationReservationDateRange({ from: "2026-08-12" })
    ).toEqual({ from: "2026-08-12" });
    expect(getAdministrationReservationDateRange({ to: "2026-08-12" })).toEqual(
      { to: "2026-08-12" }
    );
  });

  test("keeps exact-date deep links working", () => {
    expect(
      getAdministrationReservationDateRange({ date: "2026-08-12" })
    ).toEqual({ from: "2026-08-12", to: "2026-08-12" });
  });

  test("builds the same inclusive periods shown on the overview", () => {
    expect(
      getAdministrationOverviewDateRanges(Temporal.PlainDate.from("2026-08-12"))
    ).toEqual({
      today: { from: "2026-08-12", to: "2026-08-12" },
      upcoming: { from: "2026-08-13", to: "2026-09-11" },
      lastSevenDays: { from: "2026-08-06", to: "2026-08-12" },
    });
  });

  test("builds today and open-ended reservation shortcuts", () => {
    expect(
      getAdministrationReservationDateShortcuts(
        Temporal.PlainDate.from("2026-08-12")
      )
    ).toEqual({
      today: { from: "2026-08-12", to: "2026-08-12" },
      upcoming: { from: "2026-08-13" },
      past: { to: "2026-08-11" },
    });
  });

  test("defaults an unfiltered reservation list to year-to-date", () => {
    const currentDate = Temporal.PlainDate.from("2026-08-12");

    expect(getAdministrationReservationListDateRange({}, currentDate)).toEqual({
      from: "2026-01-01",
      to: "2026-08-12",
    });
    expect(
      getAdministrationReservationListDateRange(
        { from: "not-a-date", to: "" },
        currentDate
      )
    ).toEqual({ from: "2026-01-01", to: "2026-08-12" });
  });

  test("keeps explicit and open-ended reservation date filters", () => {
    const currentDate = Temporal.PlainDate.from("2026-08-12");

    expect(
      getAdministrationReservationListDateRange(
        { from: "2025-12-01", to: "2025-11-01" },
        currentDate
      )
    ).toEqual({ from: "2025-11-01", to: "2025-12-01" });
    expect(
      getAdministrationReservationListDateRange(
        { to: "2026-08-11" },
        currentDate
      )
    ).toEqual({ to: "2026-08-11" });
    expect(
      getAdministrationReservationListDateRange(
        { from: "2026-08-13" },
        currentDate
      )
    ).toEqual({ from: "2026-08-13" });
    expect(
      getAdministrationReservationListDateRange(
        { date: "2024-05-06" },
        currentDate
      )
    ).toEqual({ from: "2024-05-06", to: "2024-05-06" });
  });

  test("starts year-to-date on January 1 of the current Workspace year", () => {
    expect(
      getAdministrationReservationYearToDateRange(
        Temporal.PlainDate.from("2026-01-01")
      )
    ).toEqual({ from: "2026-01-01", to: "2026-01-01" });
    expect(
      getAdministrationReservationYearToDateRange(
        getCurrentWorkspaceDate(Temporal.Instant.from("2026-12-31T23:30:00Z"))
      )
    ).toEqual({ from: "2027-01-01", to: "2027-01-01" });
  });
});
