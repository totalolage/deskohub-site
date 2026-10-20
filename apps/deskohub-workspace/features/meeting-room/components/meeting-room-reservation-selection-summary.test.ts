import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { getMeetingRoomReservationSelectionSummary } from "./meeting-room-reservation-selection-summary";

describe("meeting-room selection summary", () => {
  // The contact step renders the summary on the server and again in the
  // browser, whose ICU spacing differs from Node's.
  test.each(["en-US", "cs-CZ"] as const)(
    "formats the time identically on the server and in the browser in %s",
    (locale) => {
      const summary = getMeetingRoomReservationSelectionSummary(
        { durationKey: "hour:1", startDateTime: "2026-10-20T11:00" },
        locale
      );

      const time = summary.rows.at(-1)?.value ?? "";
      expect(time).toMatch(/11/);
      expect(time).not.toMatch(/[  ]/);
    }
  );
});
