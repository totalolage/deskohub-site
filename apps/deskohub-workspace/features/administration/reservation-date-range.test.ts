import { describe, expect, test } from "bun:test";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  getAdministrationOverviewDateRanges,
  getAdministrationReservationDateRange,
  getAdministrationReservationDateShortcuts,
  getAdministrationReservationListDateRange,
  getAdministrationReservationListDefaultDateRange,
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

  test("defaults an unfiltered reservation list to an open-ended range from January 1", () => {
    const currentDate = Temporal.PlainDate.from("2026-08-12");

    expect(getAdministrationReservationListDateRange({}, currentDate)).toEqual({
      from: "2026-01-01",
    });
    expect(
      getAdministrationReservationListDateRange(
        { from: "not-a-date", to: "" },
        currentDate
      )
    ).toEqual({ from: "2026-01-01" });
  });

  test("keeps a customer's complete reservation history without a default range", () => {
    const currentDate = Temporal.PlainDate.from("2026-08-12");

    expect(
      getAdministrationReservationListDateRange(
        { customerId: "customer-one" },
        currentDate
      )
    ).toBeUndefined();
    expect(
      getAdministrationReservationListDateRange(
        { customerId: "customer-one", from: "2026-08-13" },
        currentDate
      )
    ).toEqual({ from: "2026-08-13" });
  });

  test("keeps every refund still owed in the refund queue without a default range", () => {
    // A refund owed on last year's reservation stays in the queue on January 1.
    const currentDate = Temporal.PlainDate.from("2027-01-01");

    expect(
      getAdministrationReservationListDateRange(
        { status: "needs_refund" },
        currentDate
      )
    ).toBeUndefined();
    expect(
      getAdministrationReservationListDateRange(
        { from: "2026-12-01", status: "needs_refund" },
        currentDate
      )
    ).toEqual({ from: "2026-12-01" });
    expect(
      getAdministrationReservationListDateRange(
        { status: "cancelled" },
        currentDate
      )
    ).toEqual({ from: "2027-01-01" });
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

  test("starts the default range on January 1 of the current Workspace year", () => {
    expect(
      getAdministrationReservationListDefaultDateRange(
        Temporal.PlainDate.from("2026-01-01")
      )
    ).toEqual({ from: "2026-01-01" });
    expect(
      getAdministrationReservationListDefaultDateRange(
        getCurrentWorkspaceDate(Temporal.Instant.from("2026-12-31T23:30:00Z"))
      )
    ).toEqual({ from: "2027-01-01" });
  });
});
