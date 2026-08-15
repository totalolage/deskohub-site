import { describe, expect, test } from "bun:test";
import type { CustomerReservationSummary } from "../contracts";
import { groupCustomerReservations } from "./customer-reservation-history.service";

const reservation = (
  id: string,
  endsAt: string | null,
  status: CustomerReservationSummary["status"] = "confirmed"
): CustomerReservationSummary => ({
  id,
  product: { kind: "other" },
  startsAt: null,
  endsAt,
  seats: null,
  status,
});

describe("customer reservation history", () => {
  test("groups active, completed, cancelled, and incomplete reservations", () => {
    const now = Temporal.Instant.from("2026-08-15T12:00:00Z");
    const groups = groupCustomerReservations(
      [
        reservation("future", "2026-08-15T13:00:00Z"),
        reservation("boundary", "2026-08-15T12:00:00Z"),
        reservation("cancelled", "2026-08-16T12:00:00Z", "cancelled"),
        reservation("missing-date", null),
      ],
      now
    );

    expect(groups.current.map(({ id }) => id)).toEqual(["future"]);
    expect(groups.past.map(({ id }) => id)).toEqual(["boundary", "cancelled"]);
    expect(groups.unavailable.map(({ id }) => id)).toEqual(["missing-date"]);
  });
});
