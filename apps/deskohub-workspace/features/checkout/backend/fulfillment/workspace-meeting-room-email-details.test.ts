import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { createWorkspaceMeetingRoomEmailDetailRows } from "./workspace-meeting-room-email-details";

const copy = {
  dateLabel: "Reservation date",
  reservationLabel: "Reservation",
  reservationTitle: "Meeting Room",
  timeLabel: "Reservation time",
  wholeDay: "whole day",
};

describe("meeting-room email details", () => {
  test("preserves the Open Space-length interval as a time range", () => {
    const rows = createWorkspaceMeetingRoomEmailDetailRows(
      {
        reservedFrom: Temporal.Instant.from("2026-06-09T22:00:00Z"),
        reservedUntil: Temporal.Instant.from("2026-06-10T15:00:00Z"),
      },
      "en-US",
      copy
    );

    expect(rows[2]?.value).not.toBe(copy.wholeDay);
    expect(rows[2]?.value).toContain("12:00 AM");
    expect(rows[2]?.value).toContain("5:00 PM");
  });

  test("uses the whole-day label for consecutive Prague midnights across DST", () => {
    const rows = createWorkspaceMeetingRoomEmailDetailRows(
      {
        reservedFrom: Temporal.Instant.from("2026-10-24T22:00:00Z"),
        reservedUntil: Temporal.Instant.from("2026-10-25T23:00:00Z"),
      },
      "en-US",
      copy
    );

    expect(rows[2]?.value).toBe(copy.wholeDay);
  });
});
