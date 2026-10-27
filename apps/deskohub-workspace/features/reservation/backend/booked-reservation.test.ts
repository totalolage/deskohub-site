import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import {
  type BookedReservation,
  decodeBookedReservation,
} from "@/features/reservation/backend/booked-reservation";
import type { ReservationRecord } from "@/features/reservation/backend/reservation-record";

const makeRecord = (
  input: Partial<ReservationRecord> = {}
): ReservationRecord => ({
  status: "CONFIRMED",
  startDate: "2026-03-10T08:00:00Z",
  endDate: "2026-03-10T10:00:00Z",
  seats: "2",
  ...input,
});

const toPlain = (booked: BookedReservation) => ({
  start: Option.getOrNull(Option.map(booked.start, String)),
  end: Option.getOrNull(Option.map(booked.end, String)),
  interval: Option.getOrNull(
    Option.map(booked.interval, ({ startsAt, endsAt }) => [
      String(startsAt),
      String(endsAt),
    ])
  ),
});

describe("decodeBookedReservation bounds", () => {
  test.each([
    {
      name: "UTC bounds",
      startDate: "2026-03-10T08:00:00Z",
      endDate: "2026-03-10T10:00:00Z",
      expected: {
        start: "2026-03-10T08:00:00Z",
        end: "2026-03-10T10:00:00Z",
        interval: ["2026-03-10T08:00:00Z", "2026-03-10T10:00:00Z"],
      },
    },
    {
      name: "numeric offsets and fractional seconds",
      startDate: "2026-03-10T09:00:00.250+01:00",
      endDate: "2026-03-10T11:00:00+01:00",
      expected: {
        start: "2026-03-10T08:00:00.25Z",
        end: "2026-03-10T10:00:00Z",
        interval: ["2026-03-10T08:00:00.25Z", "2026-03-10T10:00:00Z"],
      },
    },
    {
      name: "an unreadable start",
      startDate: "not-a-date",
      endDate: "2026-03-10T10:00:00Z",
      expected: { start: null, end: "2026-03-10T10:00:00Z", interval: null },
    },
    {
      name: "an unreadable end keeps the start",
      startDate: "2026-03-10T08:00:00Z",
      endDate: "not-a-date",
      expected: { start: "2026-03-10T08:00:00Z", end: null, interval: null },
    },
    {
      name: "an impossible calendar date",
      startDate: "2026-02-30T08:00:00Z",
      endDate: "2026-03-10T10:00:00Z",
      expected: { start: null, end: "2026-03-10T10:00:00Z", interval: null },
    },
    {
      name: "a local time without an offset",
      startDate: "2026-03-10T08:00:00",
      endDate: "2026-03-10T10:00:00Z",
      expected: { start: null, end: "2026-03-10T10:00:00Z", interval: null },
    },
    {
      name: "an end equal to the start",
      startDate: "2026-03-10T08:00:00Z",
      endDate: "2026-03-10T08:00:00Z",
      expected: {
        start: "2026-03-10T08:00:00Z",
        end: "2026-03-10T08:00:00Z",
        interval: null,
      },
    },
    {
      name: "an end before the start",
      startDate: "2026-03-10T10:00:00Z",
      endDate: "2026-03-10T08:00:00Z",
      expected: {
        start: "2026-03-10T10:00:00Z",
        end: "2026-03-10T08:00:00Z",
        interval: null,
      },
    },
  ])("decodes $name", ({ startDate, endDate, expected }) => {
    expect(
      toPlain(decodeBookedReservation(makeRecord({ startDate, endDate })))
    ).toEqual(expected);
  });
});

describe("decodeBookedReservation seats", () => {
  test.each([
    { seats: "1", expected: 1 },
    { seats: "12", expected: 12 },
    { seats: "0", expected: null },
    { seats: "-1", expected: null },
    { seats: "1.5", expected: null },
    { seats: "abc", expected: null },
    { seats: "", expected: null },
  ])("decodes seats $seats", ({ seats, expected }) => {
    expect(
      Option.getOrNull(decodeBookedReservation(makeRecord({ seats })).seats)
    ).toBe(expected);
  });
});
