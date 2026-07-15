import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import {
  getEarliestMeetingRoomStartDateTime,
  getMeetingRoomAvailabilityToDate,
  getMeetingRoomReservationInterval,
} from "./meeting-room-reservation-time";

describe("meeting room reservation time helpers", () => {
  test("uses the earliest whole-hour start allowed by the duration", () => {
    expect(
      getEarliestMeetingRoomStartDateTime(
        60,
        Temporal.Instant.from("2026-07-12T12:37:00Z")
      )
    ).toBe("2026-07-12T14:00");
  });

  test("finds the earliest start across a spring DST transition", () => {
    expect(
      getEarliestMeetingRoomStartDateTime(
        60,
        Temporal.Instant.from("2026-03-29T00:30:00Z")
      )
    ).toBe("2026-03-29T01:00");
  });

  test("accounts for the selected duration when finding the earliest start", () => {
    expect(
      getEarliestMeetingRoomStartDateTime(
        240,
        Temporal.Instant.from("2026-07-12T12:37:00Z")
      )
    ).toBe("2026-07-12T11:00");
  });

  test("adds selected durations as absolute Prague instants across DST changes", () => {
    const interval = getMeetingRoomReservationInterval(
      "2026-03-29T00:00",
      1440
    );

    expect(interval).toEqual({
      startsAt: "2026-03-28T23:00:00Z",
      endsAt: "2026-03-29T23:00:00Z",
    });
    expect(getMeetingRoomAvailabilityToDate(interval!)).toBe("2026-03-30");
  });

  test("rejects nonexistent Prague times during the spring DST transition", () => {
    expect(
      getMeetingRoomReservationInterval("2026-03-29T02:00", 60)
    ).toBeNull();
  });

  test("rejects ambiguous Prague times during the autumn DST transition", () => {
    expect(
      getMeetingRoomReservationInterval("2026-10-25T02:00", 60)
    ).toBeNull();
  });
});
