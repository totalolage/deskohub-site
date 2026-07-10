import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import {
  getMeetingRoomAvailabilityToDate,
  getMeetingRoomReservationInterval,
} from "./meeting-room-reservation-time";

describe("meeting room reservation time helpers", () => {
  test("adds selected durations as absolute Prague instants across DST changes", () => {
    const interval = getMeetingRoomReservationInterval(
      "2026-03-29T00:00",
      1440
    );

    expect(interval).toEqual({
      date: "2026-03-29",
      startsAt: "2026-03-28T23:00:00Z",
      endsAt: "2026-03-29T23:00:00Z",
      durationMinutes: 1440,
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
