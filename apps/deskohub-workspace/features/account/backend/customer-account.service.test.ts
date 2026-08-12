import { describe, expect, test } from "bun:test";
import type { CustomerReservationSummary } from "../contracts";
import { groupCustomerReservations } from "./customer-account.service";

const reservation = (
  overrides: Partial<CustomerReservationSummary> = {}
): CustomerReservationSummary => ({
  id: "reservation",
  product: { kind: "other" },
  startsAt: "2026-08-11T11:00:00Z",
  endsAt: "2026-08-11T12:00:00Z",
  seats: 1,
  status: "confirmed",
  ...overrides,
});

describe("customer reservation grouping", () => {
  const now = Temporal.Instant.from("2026-08-11T12:00:00Z");

  test("groups live reservations by end time", () => {
    const future = reservation({
      id: "future",
      endsAt: "2026-08-11T13:00:00Z",
    });
    const endedNow = reservation({ id: "ended-now" });

    expect(groupCustomerReservations([future, endedNow], now)).toEqual({
      current: [future],
      past: [endedNow],
      unavailable: [],
    });
  });

  test("treats future cancellations as history and isolates missing dates", () => {
    const cancelled = reservation({
      id: "cancelled",
      endsAt: "2026-08-12T12:00:00Z",
      status: "cancelled",
    });
    const unavailable = reservation({ id: "unavailable", endsAt: null });

    expect(groupCustomerReservations([cancelled, unavailable], now)).toEqual({
      current: [],
      past: [cancelled],
      unavailable: [unavailable],
    });
  });
});
