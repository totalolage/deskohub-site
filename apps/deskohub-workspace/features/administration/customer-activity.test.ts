import { describe, expect, test } from "bun:test";
import { groupCustomerReservations } from "./customer-activity";
import { loadFixtureReservations } from "./fixtures";

describe("customer reservation groups", () => {
  test("separates past, current and future, and unavailable reservations", () => {
    const fixture = loadFixtureReservations({}).items[0];
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const groups = groupCustomerReservations(
      [
        {
          ...fixture,
          id: "past",
          endsAt: "2026-08-09T23:59:59Z",
        },
        {
          ...fixture,
          id: "current",
          endsAt: "2026-08-10T12:00:00Z",
        },
        {
          ...fixture,
          id: "unknown",
          endsAt: null,
        },
      ],
      Temporal.Instant.from("2026-08-10T12:00:00Z")
    );

    expect(groups.past.map(({ id }) => id)).toEqual(["past", "current"]);
    expect(groups.currentAndFuture.map(({ id }) => id)).toEqual([]);
    expect(groups.unavailable.map(({ id }) => id)).toEqual(["unknown"]);
  });
});
