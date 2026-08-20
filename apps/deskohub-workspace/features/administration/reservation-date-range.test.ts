import { describe, expect, test } from "bun:test";
import {
  getAdministrationOverviewDateRanges,
  getAdministrationReservationDateRange,
  getAdministrationReservationDateShortcuts,
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
});
