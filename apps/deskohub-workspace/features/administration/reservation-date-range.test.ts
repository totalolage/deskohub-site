import { describe, expect, test } from "bun:test";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  getAdministrationReservationListDateRange,
  getAdministrationReservationListDefaultDateRange,
} from "./reservation-date-range";

describe("administration reservation date ranges", () => {
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
