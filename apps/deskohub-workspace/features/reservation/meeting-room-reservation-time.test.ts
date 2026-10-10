import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import {
  findMeetingRoomReservationDuration,
  getEarliestMeetingRoomStartDateTime,
  getMeetingRoomLastServiceDate,
  getMeetingRoomReservationInterval,
} from "./meeting-room-reservation-time";

describe("meeting room reservation time helpers", () => {
  test("uses the earliest whole-hour start allowed by the duration", () => {
    expect(
      getEarliestMeetingRoomStartDateTime(
        { unit: "hour", amount: 1 },
        Temporal.Instant.from("2026-07-12T12:37:00Z")
      )
    ).toBe("2026-07-12T14:00");
  });

  test("finds the earliest start across a spring DST transition", () => {
    expect(
      getEarliestMeetingRoomStartDateTime(
        { unit: "hour", amount: 1 },
        Temporal.Instant.from("2026-03-29T00:30:00Z")
      )
    ).toBe("2026-03-29T01:00");
  });

  test("accounts for the selected duration when finding the earliest start", () => {
    expect(
      getEarliestMeetingRoomStartDateTime(
        { unit: "hour", amount: 4 },
        Temporal.Instant.from("2026-07-12T12:37:00Z")
      )
    ).toBe("2026-07-12T11:00");
  });

  test("keeps whole-day reservations at Prague midnight across spring DST", () => {
    const interval = getMeetingRoomReservationInterval("2026-03-29T10:00", {
      unit: "day",
      amount: 1,
    });

    expect(interval).toEqual({
      startsAt: "2026-03-28T23:00:00Z",
      endsAt: "2026-03-29T22:00:00Z",
    });
    expect(getMeetingRoomLastServiceDate(interval!)).toBe("2026-03-29");
  });

  test("keeps whole-day reservations at Prague midnight across autumn DST", () => {
    expect(
      getMeetingRoomReservationInterval("2026-10-25T10:00", {
        unit: "day",
        amount: 1,
      })
    ).toEqual({
      startsAt: "2026-10-24T22:00:00Z",
      endsAt: "2026-10-25T23:00:00Z",
    });
  });

  test("rejects nonexistent Prague times during the spring DST transition", () => {
    expect(
      getMeetingRoomReservationInterval("2026-03-29T02:00", {
        unit: "hour",
        amount: 1,
      })
    ).toBeNull();
  });

  test("rejects ambiguous Prague times during the autumn DST transition", () => {
    expect(
      getMeetingRoomReservationInterval("2026-10-25T02:00", {
        unit: "hour",
        amount: 1,
      })
    ).toBeNull();
  });
});

describe("findMeetingRoomReservationDuration", () => {
  test("finds the purchasable duration a booked interval used", () => {
    expect(
      findMeetingRoomReservationDuration({
        startsAt: Temporal.Instant.from("2026-07-12T07:00:00Z"),
        endsAt: Temporal.Instant.from("2026-07-12T11:00:00Z"),
      })
    ).toEqual({ unit: "hour", amount: 4 });
    // A whole Prague day starts at local midnight.
    expect(
      findMeetingRoomReservationDuration({
        startsAt: Temporal.Instant.from("2026-07-11T22:00:00Z"),
        endsAt: Temporal.Instant.from("2026-07-12T22:00:00Z"),
      })
    ).toEqual({ unit: "day", amount: 1 });
  });

  test("finds nothing for an interval no duration produces", () => {
    expect(
      findMeetingRoomReservationDuration({
        startsAt: Temporal.Instant.from("2026-07-12T07:00:00Z"),
        endsAt: Temporal.Instant.from("2026-07-12T08:37:00Z"),
      })
    ).toBeUndefined();
  });
});
