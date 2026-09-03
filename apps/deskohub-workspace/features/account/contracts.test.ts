import { describe, expect, test } from "bun:test";
import { Temporal } from "@js-temporal/polyfill";
import {
  type CustomerReservationSummary,
  groupCustomerReservations,
} from "./contracts";

const now = Temporal.Instant.from("2026-09-03T12:00:00Z");

const reservation = (
  overrides: Partial<CustomerReservationSummary> = {}
): CustomerReservationSummary => ({
  id: "reservation-1",
  product: { kind: "meeting-room" },
  startsAt: "2026-09-03T14:00:00Z",
  endsAt: "2026-09-03T16:00:00Z",
  seats: 2,
  status: "confirmed",
  ...overrides,
});

describe("groupCustomerReservations", () => {
  test("groups an ongoing reservation as current until its exact end instant", () => {
    const groups = groupCustomerReservations(
      [
        reservation({ id: "later-today" }),
        reservation({
          id: "exact-end",
          startsAt: "2026-09-03T10:00:00Z",
          endsAt: "2026-09-03T12:00:00Z",
        }),
      ],
      now
    );

    expect(groups.current.map(({ id }) => id)).toEqual(["later-today"]);
    expect(groups.past.map(({ id }) => id)).toEqual(["exact-end"]);
    expect(groups.unavailable).toHaveLength(0);
  });

  test("moves an ended reservation to the past group", () => {
    const groups = groupCustomerReservations(
      [
        reservation({
          id: "yesterday",
          startsAt: "2026-08-21T08:00:00Z",
          endsAt: "2026-08-21T18:00:00Z",
        }),
      ],
      now
    );

    expect(groups.current).toHaveLength(0);
    expect(groups.past.map(({ id }) => id)).toEqual(["yesterday"]);
  });

  test("groups a cancelled reservation as past even with a future end date", () => {
    const groups = groupCustomerReservations(
      [reservation({ id: "cancelled", status: "cancelled" })],
      now
    );

    expect(groups.current).toHaveLength(0);
    expect(groups.past.map(({ id }) => id)).toEqual(["cancelled"]);
  });

  test("keeps a pending reservation current while its end instant is in the future", () => {
    const groups = groupCustomerReservations(
      [reservation({ id: "pending", status: "pending" })],
      now
    );

    expect(groups.current.map(({ id }) => id)).toEqual(["pending"]);
  });

  test("groups a missing end date as unavailable", () => {
    const groups = groupCustomerReservations(
      [reservation({ id: "missing-end", endsAt: null })],
      now
    );

    expect(groups.unavailable.map(({ id }) => id)).toEqual(["missing-end"]);
    expect(groups.current).toHaveLength(0);
    expect(groups.past).toHaveLength(0);
  });

  test("groups an unparseable end date as unavailable instead of throwing", () => {
    const groups = groupCustomerReservations(
      [reservation({ id: "invalid-end", endsAt: "not-an-instant" })],
      now
    );

    expect(groups.unavailable.map(({ id }) => id)).toEqual(["invalid-end"]);
  });
});
