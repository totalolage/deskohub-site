import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  findMeetingRoomReservationDuration,
  getEarliestMeetingRoomStartDateTime,
  getMeetingRoomDayStartTimes,
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

describe("getMeetingRoomDayStartTimes", () => {
  const longBefore = Temporal.Instant.from("2026-01-01T00:00:00Z");
  const startHours = (
    startTimes: ReturnType<typeof getMeetingRoomDayStartTimes>
  ) => startTimes.map(({ startDateTime }) => startDateTime.slice(11));

  test("offers every whole hour of a future day for hourly durations", () => {
    for (const amount of [1, 4] as const) {
      const startTimes = getMeetingRoomDayStartTimes({
        date: plainDateStringSchema.make("2026-07-14"),
        duration: { unit: "hour", amount },
        now: longBefore,
      });

      expect(startHours(startTimes)).toEqual(
        Array.from(
          { length: 24 },
          (_, hour) => `${String(hour).padStart(2, "0")}:00`
        )
      );
      expect(startTimes[0]?.interval).toEqual({
        startsAt: "2026-07-13T22:00:00Z",
        endsAt: Temporal.Instant.from("2026-07-13T22:00:00Z")
          .add({ hours: amount })
          .toString(),
      });
    }
  });

  test("lets a late hourly start run past midnight", () => {
    const [lastStart] = getMeetingRoomDayStartTimes({
      date: plainDateStringSchema.make("2026-07-14"),
      duration: { unit: "hour", amount: 4 },
      now: longBefore,
    }).slice(-1);

    expect(lastStart).toEqual({
      startDateTime: "2026-07-14T23:00",
      interval: {
        startsAt: "2026-07-14T21:00:00Z",
        endsAt: "2026-07-15T01:00:00Z",
      },
    });
  });

  test("offers one whole-day start from Prague midnight to the next", () => {
    expect(
      getMeetingRoomDayStartTimes({
        date: plainDateStringSchema.make("2026-07-14"),
        duration: { unit: "day", amount: 1 },
        now: longBefore,
      })
    ).toEqual([
      {
        startDateTime: "2026-07-14T00:00",
        interval: {
          startsAt: "2026-07-13T22:00:00Z",
          endsAt: "2026-07-14T22:00:00Z",
        },
      },
    ]);
  });

  test("starts from the earliest start the form accepts today", () => {
    // 14:37 in Prague: a one-hour booking may start at 14:00 and a four-hour
    // booking at 11:00, while their exclusive ends are still ahead.
    const now = Temporal.Instant.from("2026-07-12T12:37:00Z");

    expect(
      startHours(
        getMeetingRoomDayStartTimes({
          date: plainDateStringSchema.make("2026-07-12"),
          duration: { unit: "hour", amount: 1 },
          now,
        })
      )[0]
    ).toBe("14:00");
    expect(
      startHours(
        getMeetingRoomDayStartTimes({
          date: plainDateStringSchema.make("2026-07-12"),
          duration: { unit: "hour", amount: 4 },
          now,
        })
      )[0]
    ).toBe("11:00");
    expect(
      getMeetingRoomDayStartTimes({
        date: plainDateStringSchema.make("2026-07-12"),
        duration: { unit: "day", amount: 1 },
        now,
      })
    ).toHaveLength(1);
  });

  test("offers nothing on a past day", () => {
    for (const duration of [
      { unit: "hour", amount: 1 },
      { unit: "hour", amount: 4 },
      { unit: "day", amount: 1 },
    ] as const) {
      expect(
        getMeetingRoomDayStartTimes({
          date: plainDateStringSchema.make("2026-07-11"),
          duration,
          now: Temporal.Instant.from("2026-07-12T12:37:00Z"),
        })
      ).toEqual([]);
    }
  });

  test("skips the hour the spring daylight-saving change removes", () => {
    const startTimes = getMeetingRoomDayStartTimes({
      date: plainDateStringSchema.make("2026-03-29"),
      duration: { unit: "hour", amount: 1 },
      now: longBefore,
    });

    expect(startHours(startTimes)).toHaveLength(23);
    expect(startHours(startTimes)).not.toContain("02:00");
    expect(
      startTimes.find((start) => start.startDateTime.endsWith("03:00"))
    ).toEqual({
      startDateTime: "2026-03-29T03:00",
      interval: {
        startsAt: "2026-03-29T01:00:00Z",
        endsAt: "2026-03-29T02:00:00Z",
      },
    });
  });

  test("skips the repeated hour of the autumn daylight-saving change", () => {
    const startTimes = getMeetingRoomDayStartTimes({
      date: plainDateStringSchema.make("2026-10-25"),
      duration: { unit: "hour", amount: 4 },
      now: longBefore,
    });

    expect(startHours(startTimes)).toHaveLength(23);
    expect(startHours(startTimes)).not.toContain("02:00");
    expect(startTimes[0]?.interval).toEqual({
      startsAt: "2026-10-24T22:00:00Z",
      endsAt: "2026-10-25T02:00:00Z",
    });
  });

  test("keeps a 25-hour whole day across the autumn change", () => {
    expect(
      getMeetingRoomDayStartTimes({
        date: plainDateStringSchema.make("2026-10-25"),
        duration: { unit: "day", amount: 1 },
        now: longBefore,
      })[0]?.interval
    ).toEqual({
      startsAt: "2026-10-24T22:00:00Z",
      endsAt: "2026-10-25T23:00:00Z",
    });
  });
});
