import { describe, expect, test } from "bun:test";
import {
  getAvailableDurations,
  getLocalTimeInTimezone,
  isReservationWithinWorkingHours,
  type ReservationScheduleConfig,
} from "./index";

const weekday = { open: { hrs: 8, mins: 30 }, close: { hrs: 18, mins: 0 } };

const config: ReservationScheduleConfig = {
  timezone: "Europe/Prague",
  workingHours: {
    0: { open: { hrs: 0, mins: 0 }, close: { hrs: 0, mins: 0 } },
    1: weekday,
    2: weekday,
    3: weekday,
    4: weekday,
    5: { open: { hrs: 8, mins: 30 }, close: { hrs: 24, mins: 0 } },
    6: { open: { hrs: 10, mins: 0 }, close: { hrs: 14, mins: 0 } },
  },
  validation: {
    minDurationHours: 1,
    durationIncrementHours: 0.5,
    fallbackMaxDurationHours: 3,
  },
};

describe("getLocalTimeInTimezone", () => {
  test("converts an instant to the weekday and clock time of the time zone", () => {
    // Monday 2026-11-02 08:05 UTC is 09:05 in Prague (CET, UTC+1).
    expect(
      getLocalTimeInTimezone(new Date("2026-11-02T08:05:00Z"), "Europe/Prague")
    ).toEqual({ dayOfWeek: 1, hours: 9, minutes: 5, timeString: "09:05" });
  });

  test("moves to the next local day when the zone has passed midnight", () => {
    expect(
      getLocalTimeInTimezone(new Date("2026-03-28T23:00:00Z"), "Europe/Prague")
    ).toEqual({ dayOfWeek: 0, hours: 0, minutes: 0, timeString: "00:00" });
    expect(
      getLocalTimeInTimezone(new Date("2026-11-02T23:59:00Z"), "UTC")
    ).toEqual({ dayOfWeek: 1, hours: 23, minutes: 59, timeString: "23:59" });
  });

  test("skips the missing hour when daylight saving time starts", () => {
    const beforeGap = new Date("2026-03-29T00:30:00Z");
    const afterGap = new Date("2026-03-29T01:30:00Z");

    expect(getLocalTimeInTimezone(beforeGap, "Europe/Prague").timeString).toBe(
      "01:30"
    );
    expect(getLocalTimeInTimezone(afterGap, "Europe/Prague").timeString).toBe(
      "03:30"
    );
  });

  test("repeats the clock hour when daylight saving time ends", () => {
    const summerTime = new Date("2026-10-25T00:30:00Z");
    const winterTime = new Date("2026-10-25T01:30:00Z");

    expect(getLocalTimeInTimezone(summerTime, "Europe/Prague")).toEqual(
      getLocalTimeInTimezone(winterTime, "Europe/Prague")
    );
    expect(getLocalTimeInTimezone(winterTime, "Europe/Prague")).toEqual({
      dayOfWeek: 0,
      hours: 2,
      minutes: 30,
      timeString: "02:30",
    });
  });

  test("rejects an unknown time zone", () => {
    expect(() =>
      getLocalTimeInTimezone(new Date("2026-11-02T08:05:00Z"), "Mars/Olympus")
    ).toThrow(RangeError);
  });
});

describe("isReservationWithinWorkingHours", () => {
  // Monday 2026-11-02 in Prague is UTC+1.
  const mondayAt = (localTime: string) =>
    new Date(`2026-11-02T${localTime}:00+01:00`);

  test("accepts a reservation from opening time to closing time", () => {
    expect(
      isReservationWithinWorkingHours(mondayAt("08:30"), 9.5, config)
    ).toBe(true);
  });

  test("rejects a start before opening or at closing time", () => {
    expect(isReservationWithinWorkingHours(mondayAt("08:29"), 1, config)).toBe(
      false
    );
    expect(isReservationWithinWorkingHours(mondayAt("18:00"), 1, config)).toBe(
      false
    );
  });

  test("rejects a reservation that ends after closing time", () => {
    expect(isReservationWithinWorkingHours(mondayAt("17:00"), 1, config)).toBe(
      true
    );
    expect(
      isReservationWithinWorkingHours(mondayAt("17:00"), 1.5, config)
    ).toBe(false);
  });

  test("rejects a reservation that runs into the next local day", () => {
    // Friday closes at 24:00, so only a reservation ending by midnight fits.
    const fridayAt = (localTime: string) =>
      new Date(`2026-11-06T${localTime}:00+01:00`);

    expect(
      isReservationWithinWorkingHours(fridayAt("22:00"), 1.5, config)
    ).toBe(true);
    expect(isReservationWithinWorkingHours(fridayAt("23:00"), 1, config)).toBe(
      false
    );
  });

  test("rejects every start on a day that is closed", () => {
    const sundayNoon = new Date("2026-11-08T12:00:00+01:00");

    expect(isReservationWithinWorkingHours(sundayNoon, 1, config)).toBe(false);
  });

  test("measures the end in the zone's local time across a daylight saving change", () => {
    const summerConfig: ReservationScheduleConfig = {
      ...config,
      workingHours: {
        ...config.workingHours,
        0: { open: { hrs: 1, mins: 0 }, close: { hrs: 3, mins: 30 } },
      },
    };
    // 01:30 + 1 hour on 2026-03-29 is 03:30 local time, the closing time.
    const beforeGap = new Date("2026-03-29T00:30:00Z");

    expect(isReservationWithinWorkingHours(beforeGap, 1, summerConfig)).toBe(
      true
    );
    expect(isReservationWithinWorkingHours(beforeGap, 1.5, summerConfig)).toBe(
      false
    );
  });
});

describe("getAvailableDurations", () => {
  test("offers every increment up to the fallback maximum without a start time", () => {
    expect(getAvailableDurations(null, config)).toEqual([1, 1.5, 2, 2.5, 3]);
  });

  test("offers durations that end by closing time", () => {
    expect(
      getAvailableDurations(new Date("2026-11-02T15:00:00+01:00"), config)
    ).toEqual([1, 1.5, 2, 2.5, 3]);
  });

  test("rounds the time left down to a half hour", () => {
    expect(
      getAvailableDurations(new Date("2026-11-02T15:50:00+01:00"), config)
    ).toEqual([1, 1.5, 2]);
  });

  test("counts a 24:00 closing time as midnight", () => {
    expect(
      getAvailableDurations(new Date("2026-11-06T22:30:00+01:00"), config)
    ).toEqual([1, 1.5]);
  });

  test("offers nothing outside working hours", () => {
    expect(
      getAvailableDurations(new Date("2026-11-02T08:00:00+01:00"), config)
    ).toEqual([]);
    expect(
      getAvailableDurations(new Date("2026-11-02T18:00:00+01:00"), config)
    ).toEqual([]);
    expect(
      getAvailableDurations(new Date("2026-11-08T12:00:00+01:00"), config)
    ).toEqual([]);
  });

  test("offers nothing when less than the minimum duration is left", () => {
    expect(
      getAvailableDurations(new Date("2026-11-02T17:01:00+01:00"), config)
    ).toEqual([]);
    expect(
      getAvailableDurations(new Date("2026-11-02T17:00:00+01:00"), config)
    ).toEqual([1]);
  });
});
