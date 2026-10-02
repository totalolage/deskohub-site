import { describe, expect, test } from "bun:test";
import {
  getAdministrationOverviewDateRanges,
  getAdministrationReservationDateRange,
  getAdministrationReservationDateRangeStrict,
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

  test("strictly parses the same ranges as the lenient parser", () => {
    expect(
      getAdministrationReservationDateRangeStrict({
        from: "2026-08-12",
        to: "2026-08-06",
      })
    ).toEqual({ ok: true, range: { from: "2026-08-06", to: "2026-08-12" } });
    expect(
      getAdministrationReservationDateRangeStrict({ from: "2026-08-12" })
    ).toEqual({ ok: true, range: { from: "2026-08-12" } });
    expect(
      getAdministrationReservationDateRangeStrict({ to: "2026-08-12" })
    ).toEqual({ ok: true, range: { to: "2026-08-12" } });
    expect(
      getAdministrationReservationDateRangeStrict({ date: "2026-08-12" })
    ).toEqual({
      ok: true,
      range: { from: "2026-08-12", to: "2026-08-12" },
    });
  });

  test("fails closed on malformed supplied dates without dropping them", () => {
    expect(
      getAdministrationReservationDateRangeStrict({ from: "not-a-date" })
    ).toEqual({
      ok: false,
      failures: [{ field: "from", value: "not-a-date" }],
    });
    expect(
      getAdministrationReservationDateRangeStrict({
        from: "2026-13-45",
        to: "also-bad",
      })
    ).toEqual({
      ok: false,
      failures: [
        { field: "from", value: "2026-13-45" },
        { field: "to", value: "also-bad" },
      ],
    });
    expect(
      getAdministrationReservationDateRangeStrict({ date: "08/12/2026" })
    ).toEqual({
      ok: false,
      failures: [{ field: "date", value: "08/12/2026" }],
    });
  });

  test("ignores absent strict dates", () => {
    expect(getAdministrationReservationDateRangeStrict({})).toEqual({
      ok: true,
      range: undefined,
    });
  });
});
