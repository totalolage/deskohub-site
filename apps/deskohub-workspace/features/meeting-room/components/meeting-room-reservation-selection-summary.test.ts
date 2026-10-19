import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { getMeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { getMeetingRoomReservationSelectionSummary } from "./meeting-room-reservation-selection-summary";

describe("meeting-room selection summary", () => {
  // The contact step renders the summary on the server and again in the
  // browser, whose ICU spacing differs from Node's.
  test.each(["en-US", "cs-CZ"] as const)(
    "formats the time identically on the server and in the browser in %s",
    (locale) => {
      const duration = getMeetingRoomReservationDuration("hour:1");
      const summary = getMeetingRoomReservationSelectionSummary(
        {
          duration,
          interval: getMeetingRoomReservationInterval(
            "2026-10-20T11:00",
            duration
          ),
          isWholeDay: false,
        },
        locale
      );

      const time = summary.rows.at(-1)?.value ?? "";
      expect(time).toMatch(/11/);
      expect(time).not.toMatch(/[  ]/);
    }
  );
});
