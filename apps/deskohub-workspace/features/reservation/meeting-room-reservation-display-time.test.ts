import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { formatMeetingRoomReservationDisplayTimeValue } from "./meeting-room-reservation-display-time";
import { formatReservationDisplayTimeRange } from "./reservation-date";

describe("meeting-room reservation display time", () => {
  test("preserves the Open Space-length interval as a time range", () => {
    const interval = {
      startsAt: Temporal.Instant.from("2026-06-09T22:00:00Z"),
      endsAt: Temporal.Instant.from("2026-06-10T15:00:00Z"),
    };
    const actualRange = formatReservationDisplayTimeRange(
      interval.startsAt,
      interval.endsAt,
      "en-US"
    );

    expect(
      formatMeetingRoomReservationDisplayTimeValue(
        interval,
        "en-US",
        "whole day"
      )
    ).toBe(actualRange);
  });

  test("labels consecutive Prague midnights as a whole day across DST", () => {
    expect(
      formatMeetingRoomReservationDisplayTimeValue(
        {
          startsAt: Temporal.Instant.from("2026-10-24T22:00:00Z"),
          endsAt: Temporal.Instant.from("2026-10-25T23:00:00Z"),
        },
        "en-US",
        "whole day"
      )
    ).toBe("whole day");
  });
});
