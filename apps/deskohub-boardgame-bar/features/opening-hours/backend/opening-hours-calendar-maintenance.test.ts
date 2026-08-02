import { describe, expect, test } from "bun:test";
import { Temporal } from "@js-temporal/polyfill";
import { isOpeningHoursCalendarMaintenanceTime } from "./opening-hours-calendar-maintenance";

describe("opening-hours calendar maintenance time", () => {
  test("recognizes Prague midnight during standard time", () => {
    expect(
      isOpeningHoursCalendarMaintenanceTime(
        Temporal.Instant.from("2026-01-15T23:00:00Z")
      )
    ).toBe(true);
    expect(
      isOpeningHoursCalendarMaintenanceTime(
        Temporal.Instant.from("2026-01-15T22:00:00Z")
      )
    ).toBe(false);
  });

  test("recognizes Prague midnight during daylight-saving time", () => {
    expect(
      isOpeningHoursCalendarMaintenanceTime(
        Temporal.Instant.from("2026-07-15T22:00:00Z")
      )
    ).toBe(true);
    expect(
      isOpeningHoursCalendarMaintenanceTime(
        Temporal.Instant.from("2026-07-15T23:00:00Z")
      )
    ).toBe(false);
  });
});
