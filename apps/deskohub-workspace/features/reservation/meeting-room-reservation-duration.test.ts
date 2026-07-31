import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  getMeetingRoomReservationDuration,
  getMeetingRoomReservationDurationKey,
  meetingRoomReservationDurationSchema,
  meetingRoomReservationDurations,
} from "./meeting-room-reservation-duration";

describe("meetingRoomReservationDurationSchema", () => {
  it.each(
    meetingRoomReservationDurations
  )("accepts $unit:$amount", (duration) => {
    expect(Schema.is(meetingRoomReservationDurationSchema)(duration)).toBe(
      true
    );
  });

  it.each([
    { unit: "hour", amount: 24 },
    { unit: "day", amount: 4 },
    { unit: "minute", amount: 60 },
    { unit: "day", amount: 1.5 },
  ])("rejects unsupported duration %#", (duration) => {
    expect(Schema.is(meetingRoomReservationDurationSchema)(duration)).toBe(
      false
    );
  });

  it("round-trips every form key", () => {
    for (const duration of meetingRoomReservationDurations) {
      expect(
        getMeetingRoomReservationDuration(
          getMeetingRoomReservationDurationKey(duration)
        )
      ).toEqual(duration);
    }
  });
});
