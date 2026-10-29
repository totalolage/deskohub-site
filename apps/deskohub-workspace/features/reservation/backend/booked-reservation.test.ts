import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import {
  type BookedReservation,
  decodeBookedReservation,
  decodeBookedStart,
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
      name: "hour 24",
      startDate: "2026-03-10T24:00:00Z",
      endDate: "2026-03-11T10:00:00Z",
      expected: { start: null, end: "2026-03-11T10:00:00Z", interval: null },
    },
    {
      name: "nine fraction digits",
      startDate: "2026-03-10T08:00:00.123456789Z",
      endDate: "2026-03-10T10:00:00Z",
      expected: {
        start: "2026-03-10T08:00:00.123456789Z",
        end: "2026-03-10T10:00:00Z",
        interval: ["2026-03-10T08:00:00.123456789Z", "2026-03-10T10:00:00Z"],
      },
    },
    {
      name: "more than nine fraction digits",
      startDate: "2026-03-10T08:00:00.1234567891Z",
      endDate: "2026-03-10T10:00:00Z",
      expected: { start: null, end: "2026-03-10T10:00:00Z", interval: null },
    },
    {
      name: "a leap second as the second before it",
      startDate: "2026-03-10T08:59:60Z",
      endDate: "2026-03-10T10:00:00Z",
      expected: {
        start: "2026-03-10T08:59:59Z",
        end: "2026-03-10T10:00:00Z",
        interval: ["2026-03-10T08:59:59Z", "2026-03-10T10:00:00Z"],
      },
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
    { seats: "02", expected: 2 },
    // Any spelling JavaScript reads as a positive whole number counts.
    { seats: " 2", expected: 2 },
    { seats: "2 ", expected: 2 },
    { seats: "+3", expected: 3 },
    { seats: "1.0", expected: 1 },
    { seats: "1e1", expected: 10 },
    { seats: "0x10", expected: 16 },
    { seats: "0", expected: null },
    { seats: "-1", expected: null },
    { seats: "1.5", expected: null },
    { seats: "Infinity", expected: null },
    { seats: "1_000", expected: null },
    { seats: "abc", expected: null },
    { seats: " ", expected: null },
    { seats: "", expected: null },
  ])("decodes seats $seats", ({ seats, expected }) => {
    expect(
      Option.getOrNull(decodeBookedReservation(makeRecord({ seats })).seats)
    ).toBe(expected);
  });
});

describe("decodeBookedReservation early setup", () => {
  const heldRecord = makeRecord({
    startDate: "2026-03-10T08:45:00Z",
    endDate: "2026-03-10T10:00:00Z",
  });
  const toSetup = (booked: BookedReservation) => ({
    ...toPlain(booked),
    setupStart: Option.getOrNull(Option.map(booked.setupStart, String)),
    occupiedInterval: Option.getOrNull(
      Option.map(booked.occupiedInterval, ({ startsAt, endsAt }) => [
        String(startsAt),
        String(endsAt),
      ])
    ),
  });

  test("turns the held span of a flagged meeting room into its booked time", () => {
    expect(
      toSetup(
        decodeBookedReservation(heldRecord, {
          kind: "meeting-room",
          duration: { unit: "hour", amount: 1 },
          earlySetup: true,
        })
      )
    ).toEqual({
      start: "2026-03-10T09:00:00Z",
      end: "2026-03-10T10:00:00Z",
      interval: ["2026-03-10T09:00:00Z", "2026-03-10T10:00:00Z"],
      setupStart: "2026-03-10T08:45:00Z",
      occupiedInterval: ["2026-03-10T08:45:00Z", "2026-03-10T10:00:00Z"],
    });
  });

  test.each([
    { name: "no details", details: undefined },
    {
      name: "a meeting room without setup",
      details: { kind: "meeting-room" as const },
    },
    {
      name: "a meeting room whose setup is off",
      details: { kind: "meeting-room" as const, earlySetup: false },
    },
    { name: "another family", details: { kind: "office" as const } },
  ])("keeps the held span as the booked time for $name", ({ details }) => {
    expect(toSetup(decodeBookedReservation(heldRecord, details))).toEqual({
      start: "2026-03-10T08:45:00Z",
      end: "2026-03-10T10:00:00Z",
      interval: ["2026-03-10T08:45:00Z", "2026-03-10T10:00:00Z"],
      setupStart: null,
      occupiedInterval: ["2026-03-10T08:45:00Z", "2026-03-10T10:00:00Z"],
    });
  });

  test("has no booked interval when the setup leaves no booked time", () => {
    const booked = decodeBookedReservation(
      makeRecord({
        startDate: "2026-03-10T08:45:00Z",
        endDate: "2026-03-10T09:00:00Z",
      }),
      { kind: "meeting-room", earlySetup: true }
    );

    expect(Option.isNone(booked.interval)).toBe(true);
    expect(Option.isSome(booked.occupiedInterval)).toBe(true);
  });
});

describe("decodeBookedStart", () => {
  const earlySetup = { kind: "meeting-room", earlySetup: true } as const;

  test.each([
    { name: "a flagged meeting room", details: earlySetup },
    { name: "no details", details: undefined },
    { name: "an office", details: { kind: "office" as const } },
  ])("matches the decoded booked start for $name", ({ details }) => {
    const record = makeRecord({ startDate: "2026-03-10T08:45:00Z" });

    expect(
      Option.getOrNull(Option.map(decodeBookedStart(record, details), String))
    ).toBe(
      Option.getOrNull(
        Option.map(decodeBookedReservation(record, details).start, String)
      )
    );
  });

  test("has no start when Dotypos's start is unreadable", () => {
    expect(
      Option.isNone(
        decodeBookedStart(makeRecord({ startDate: "soon" }), earlySetup)
      )
    ).toBe(true);
  });
});
