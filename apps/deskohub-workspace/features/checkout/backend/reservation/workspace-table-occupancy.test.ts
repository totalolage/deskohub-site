import "@/shared/polyfills/temporal";

import { expect, test } from "bun:test";
import { DotyposTableIdSchema } from "@deskohub/dotypos";
import type { ReservationRecord } from "@/features/reservation/backend/reservation-record";
import { toTableBookings } from "./workspace-table-occupancy";

const tableId = DotyposTableIdSchema.make("synthetic-table");
const startsAt = Date.parse("2026-03-10T08:00:00Z");
const endsAt = Date.parse("2026-03-10T10:00:00Z");

const makeRecord = (
  input: Partial<ReservationRecord> = {}
): ReservationRecord => ({
  status: "CONFIRMED",
  _tableId: tableId,
  startDate: "2026-03-10T08:00:00Z",
  endDate: "2026-03-10T10:00:00Z",
  seats: "2",
  ...input,
});

test("holds a table for active reservations with readable bounds", () => {
  expect(
    toTableBookings([makeRecord(), makeRecord({ status: "NEW", seats: "3" })])
  ).toEqual([
    { tableId, startsAt, endsAt, seats: 2 },
    { tableId, startsAt, endsAt, seats: 3 },
  ]);
});

test("drops cancelled, unassigned, and unreadable-bound reservations", () => {
  const { _tableId: _, ...unassigned } = makeRecord();

  expect(
    toTableBookings([
      makeRecord({ status: "CANCELLED" }),
      unassigned,
      makeRecord({ startDate: "not-a-date" }),
      makeRecord({ endDate: "not-a-date" }),
    ])
  ).toEqual([]);
});

test("drops reservations whose bounds aren't real instants", () => {
  expect(
    toTableBookings([
      makeRecord({ startDate: "2026-02-30T08:00:00Z" }),
      makeRecord({ startDate: "2026-03-10T24:00:00Z" }),
      makeRecord({ endDate: "2026-03-10T10:00:00.1234567891Z" }),
    ])
  ).toEqual([]);
});

test("keeps a booking whose bounds are reversed", () => {
  expect(
    toTableBookings([
      makeRecord({
        startDate: "2026-03-10T10:00:00Z",
        endDate: "2026-03-10T08:00:00Z",
      }),
    ])
  ).toEqual([{ tableId, startsAt: endsAt, endsAt: startsAt, seats: 2 }]);
});

test("counts an unreadable seat count as one seat", () => {
  expect(
    toTableBookings(["0", "abc", ""].map((seats) => makeRecord({ seats })))
  ).toEqual([
    { tableId, startsAt, endsAt, seats: 1 },
    { tableId, startsAt, endsAt, seats: 1 },
    { tableId, startsAt, endsAt, seats: 1 },
  ]);
});
