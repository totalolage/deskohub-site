import { describe, expect, test } from "bun:test";
import type {
  CustomerAvailability,
  CustomerMeetingRoomDuration,
  CustomerMeetingRoomStartTimes,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Option, Result } from "effect";
import { SelectionIncomplete } from "./booking-selection";
import {
  defaultMeetingRoomDraft,
  type MeetingRoomDraft,
  meetingRoomAvailabilityQuery,
  meetingRoomEnablement,
  meetingRoomStartTimesQuery,
  reconcileMeetingRoomDraft,
  selectMeetingRoomDate,
  selectMeetingRoomStartTime,
  toMeetingRoomSelection,
} from "./meeting-room-selection";

const money = { value: 0, exponent: 2, currency: "CZK" };

const meetingRoomOffering = (
  duration: CustomerMeetingRoomDuration
): CustomerOffering => ({
  family: "meeting-room",
  duration,
  durationLabel: duration,
  name: "Meeting room",
  description: "",
  usage: "",
  price: money,
  advertisedPrice: { price: money, discount: money },
});

const offerings = (["hour:1", "hour:4", "day:1"] as const).map(
  meetingRoomOffering
);

const today = "2026-11-07";
// 10:00 in Prague (CET).
const now = new Date("2026-11-07T09:00:00Z");

const start = (
  startDateTime: string,
  startsAt: string,
  endsAt: string,
  earlySetupAvailable = true
) => ({ startDateTime, startsAt, endsAt, earlySetupAvailable });

const hourlyStarts: CustomerMeetingRoomStartTimes = {
  date: today,
  duration: "hour:1",
  startTimes: [
    start(
      "2026-11-07T10:00",
      "2026-11-07T09:00:00Z",
      "2026-11-07T10:00:00Z",
      false
    ),
    start("2026-11-07T11:00", "2026-11-07T10:00:00Z", "2026-11-07T11:00:00Z"),
    start("2026-11-07T23:00", "2026-11-07T22:00:00Z", "2026-11-07T23:00:00Z"),
  ],
};

const availability = (
  overrides: Partial<CustomerAvailability> = {}
): CustomerAvailability => ({
  from: today,
  to: today,
  unavailableDates: [],
  reservedDeskWorkstationRequiredDates: [],
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: [],
  notices: [],
  ...overrides,
});

const fresh = defaultMeetingRoomDraft(today, offerings);

const reconcile = (
  draft: MeetingRoomDraft,
  startTimes: Option.Option<CustomerMeetingRoomStartTimes>,
  at: Date = now
) => reconcileMeetingRoomDraft(draft, startTimes, at);

const blockerTags = (
  draft: MeetingRoomDraft,
  startTimes: Option.Option<CustomerMeetingRoomStartTimes>,
  settled: Option.Option<CustomerAvailability>
) =>
  meetingRoomEnablement(draft, {
    now,
    startTimes,
    availability: settled,
  }).blockers.map(({ _tag }) => _tag);

describe("defaultMeetingRoomDraft", () => {
  test("opens on one hour today with the start still to fill in", () => {
    expect(fresh).toEqual({
      date: today,
      duration: "hour:1",
      startTime: Option.none(),
      earlySetup: false,
    });
  });

  test("falls back to the first duration offered without one hour", () => {
    expect(
      defaultMeetingRoomDraft(today, [meetingRoomOffering("hour:4")]).duration
    ).toBe("hour:4");
  });
});

describe("reconcileMeetingRoomDraft", () => {
  test("fills in the earliest free start", () => {
    expect(reconcile(fresh, Option.some(hourlyStarts)).startTime).toEqual(
      Option.some("10:00")
    );
  });

  test("skips starts that have already ended", () => {
    // 10:30 in Prague: the 10:00 hour has not ended, so it still counts.
    expect(
      reconcile(
        fresh,
        Option.some(hourlyStarts),
        new Date("2026-11-07T09:30:00Z")
      ).startTime
    ).toEqual(Option.some("10:00"));
    // 11:00 in Prague: the 10:00 hour has ended.
    expect(
      reconcile(
        fresh,
        Option.some(hourlyStarts),
        new Date("2026-11-07T10:00:00Z")
      ).startTime
    ).toEqual(Option.some("11:00"));
  });

  test("stays without a start when none is free", () => {
    const none = { ...hourlyStarts, startTimes: [] };

    expect(reconcile(fresh, Option.some(none))).toEqual(fresh);
  });

  test("ignores starts loaded for another date or duration", () => {
    const otherDate = { ...hourlyStarts, date: "2026-11-08" };
    const otherDuration = { ...hourlyStarts, duration: "hour:4" as const };

    expect(reconcile(fresh, Option.some(otherDate))).toBe(fresh);
    expect(reconcile(fresh, Option.some(otherDuration))).toBe(fresh);
  });

  test("keeps early setup only when the chosen start offers it", () => {
    const at11 = {
      ...selectMeetingRoomStartTime(fresh, "11:00"),
      earlySetup: true,
    };
    expect(reconcile(at11, Option.some(hourlyStarts)).earlySetup).toBe(true);

    const at10 = { ...at11, startTime: Option.some("10:00") };
    expect(reconcile(at10, Option.some(hourlyStarts)).earlySetup).toBe(false);
  });

  test("clears early setup when the chosen start is no longer free", () => {
    const at12 = {
      ...selectMeetingRoomStartTime(fresh, "12:00"),
      earlySetup: true,
    };
    const reconciled = reconcile(at12, Option.some(hourlyStarts));

    expect(reconciled.startTime).toEqual(Option.some("12:00"));
    expect(reconciled.earlySetup).toBe(false);
  });

  test("keeps early setup while the starts load", () => {
    const pending = { ...fresh, earlySetup: true };

    expect(reconcile(pending, Option.none())).toBe(pending);
  });
});

describe("selectMeetingRoomDate", () => {
  test("carries the chosen start and early setup to the new date", () => {
    const chosen = {
      ...selectMeetingRoomStartTime(fresh, "11:00"),
      earlySetup: true,
    };

    expect(selectMeetingRoomDate(chosen, "2026-11-09")).toEqual({
      ...chosen,
      date: "2026-11-09",
    });
  });

  test("shows a carried start taken when the new date doesn't offer it", () => {
    const moved = selectMeetingRoomDate(
      { ...selectMeetingRoomStartTime(fresh, "15:00"), earlySetup: true },
      "2026-11-09"
    );
    const nextDay = { ...hourlyStarts, date: "2026-11-09" };
    const reconciled = reconcile(moved, Option.some(nextDay));

    expect(reconciled).toEqual({ ...moved, earlySetup: false });
    expect(
      blockerTags(reconciled, Option.some(nextDay), Option.some(availability()))
    ).toEqual(["StartUnavailable"]);
  });
});

describe("toMeetingRoomSelection", () => {
  test("is incomplete for an hourly booking without a start", () => {
    expect(toMeetingRoomSelection(fresh)).toEqual(
      Result.fail(new SelectionIncomplete({ missing: ["startTime"] }))
    );
  });

  test("names an hourly booking's start", () => {
    expect(
      toMeetingRoomSelection(selectMeetingRoomStartTime(fresh, "11:00"))
    ).toEqual(
      Result.succeed({
        family: "meeting-room",
        date: today,
        duration: "hour:1",
        startTime: "11:00",
      })
    );
  });

  test("leaves the start out of a whole day", () => {
    const wholeDay = {
      ...selectMeetingRoomStartTime(fresh, "11:00"),
      duration: "day:1" as const,
    };

    expect(toMeetingRoomSelection(wholeDay)).toEqual(
      Result.succeed({ family: "meeting-room", date: today, duration: "day:1" })
    );
  });
});

describe("availability queries", () => {
  test("asks for the free starts of the date and duration", () => {
    expect(meetingRoomStartTimesQuery(fresh)).toEqual({
      date: today,
      duration: "hour:1",
    });
  });

  test("checks the chosen start's interval once the starts load", () => {
    const at11 = selectMeetingRoomStartTime(fresh, "11:00");

    expect(meetingRoomAvailabilityQuery(at11, Option.none())).toEqual(
      Option.none()
    );
    expect(
      meetingRoomAvailabilityQuery(at11, Option.some(hourlyStarts))
    ).toEqual(
      Option.some({
        kind: "meeting-room",
        from: today,
        to: today,
        startsAt: "2026-11-07T10:00:00Z",
        endsAt: "2026-11-07T11:00:00Z",
      })
    );
  });

  test("keeps a booking ending at midnight on its own date", () => {
    const at23 = selectMeetingRoomStartTime(fresh, "23:00");

    expect(
      Option.map(
        meetingRoomAvailabilityQuery(at23, Option.some(hourlyStarts)),
        (query) => query.to
      )
    ).toEqual(Option.some(today));
  });

  test("spans a 25-hour autumn day for a whole-day booking", () => {
    const autumnDay = {
      ...defaultMeetingRoomDraft("2026-10-25", offerings),
      duration: "day:1" as const,
    };
    const wholeDayStarts: CustomerMeetingRoomStartTimes = {
      date: "2026-10-25",
      duration: "day:1",
      startTimes: [
        start(
          "2026-10-25T00:00",
          "2026-10-24T22:00:00Z",
          "2026-10-25T23:00:00Z"
        ),
      ],
    };

    expect(
      meetingRoomAvailabilityQuery(autumnDay, Option.some(wholeDayStarts))
    ).toEqual(
      Option.some({
        kind: "meeting-room",
        from: "2026-10-25",
        to: "2026-10-25",
        startsAt: "2026-10-24T22:00:00Z",
        endsAt: "2026-10-25T23:00:00Z",
      })
    );
  });
});

describe("meetingRoomEnablement", () => {
  const at11 = selectMeetingRoomStartTime(fresh, "11:00");

  test("offers today through six months and the free starts", () => {
    const enablement = meetingRoomEnablement(at11, {
      now,
      startTimes: Option.some(hourlyStarts),
      availability: Option.some(availability()),
    });

    expect(enablement.dates).toEqual({
      earliest: today,
      latest: "2027-05-07",
      unavailable: new Set(),
    });
    expect(enablement.startTimes.map(({ startTime }) => startTime)).toEqual([
      "10:00",
      "11:00",
      "23:00",
    ]);
    expect(enablement.earlySetupAvailable).toBe(true);
    expect(enablement.blockers).toEqual([]);
  });

  test("waits for the starts, then for the interval's availability", () => {
    expect(blockerTags(at11, Option.none(), Option.none())).toEqual([
      "AvailabilityPending",
    ]);
    expect(blockerTags(at11, Option.some(hourlyStarts), Option.none())).toEqual(
      ["AvailabilityPending"]
    );
  });

  test("blocks a date without a free start", () => {
    const none = { ...hourlyStarts, startTimes: [] };

    expect(blockerTags(fresh, Option.some(none), Option.none())).toEqual([
      "NoFreeStart",
    ]);
  });

  test("blocks a chosen start that isn't free", () => {
    const at12 = selectMeetingRoomStartTime(fresh, "12:00");

    expect(
      blockerTags(at12, Option.some(hourlyStarts), Option.some(availability()))
    ).toEqual(["StartUnavailable"]);
    expect(
      blockerTags(
        at11,
        Option.some(hourlyStarts),
        Option.some(availability({ meetingRoomUnavailable: true }))
      )
    ).toEqual(["StartUnavailable"]);
  });

  test("blocks a chosen start once its hour ends, from the same response", () => {
    const at10 = selectMeetingRoomStartTime(fresh, "10:00");
    const later = (iso: string) =>
      meetingRoomEnablement(at10, {
        now: new Date(iso),
        startTimes: Option.some(hourlyStarts),
        availability: Option.some(availability()),
      });

    expect(later("2026-11-07T09:59:00Z").blockers).toEqual([]);
    expect(
      later("2026-11-07T10:00:00Z").blockers.map(({ _tag }) => _tag)
    ).toEqual(["StartUnavailable"]);
    expect(
      later("2026-11-07T10:00:00Z").startTimes.map(({ startTime }) => startTime)
    ).toEqual(["11:00", "23:00"]);
  });

  test("blocks a date outside today through six months", () => {
    const late = {
      ...selectMeetingRoomStartTime(fresh, "11:00"),
      date: "2027-05-08",
    };

    expect(
      blockerTags(
        late,
        Option.some({ ...hourlyStarts, date: "2027-05-08" }),
        Option.some(availability())
      )
    ).toEqual(["DateOutOfRange"]);
  });
});
