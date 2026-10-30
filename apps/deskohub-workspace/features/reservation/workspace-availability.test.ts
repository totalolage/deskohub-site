import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { getCurrentWorkspaceDate } from "./reservation-date";
import {
  getCoworkAvailabilityQueries,
  getMeetingRoomAvailabilityQuery,
  getMeetingRoomSelectionAvailabilityQuery,
  getMeetingRoomStartTimesQuery,
  getOfficeAvailabilityQuery,
  getWorkspaceAvailabilityRange,
  isCoworkOfferAvailable,
  isMeetingRoomAvailable,
  isMeetingRoomStartTimesRequest,
  parseMeetingRoomStartTimesQuery,
  parseMeetingRoomStartTimesResponse,
  parseWorkspaceAvailabilityQuery,
} from "./workspace-availability";

const parseQuery = (params: Record<string, string>) =>
  Option.getOrThrow(
    parseWorkspaceAvailabilityQuery(new URLSearchParams(params))
  );

describe("parseWorkspaceAvailabilityQuery", () => {
  test("keeps the public kind query param as the domain discriminator", () => {
    const query = parseQuery({
      kind: "meeting-room",
      from: "2099-06-10",
      to: "2099-06-10",
    });

    expect(query).toMatchObject({
      kind: "meeting-room",
      from: "2099-06-10",
      to: "2099-06-10",
    });
    expect(query).not.toHaveProperty("date");
  });

  test("parses office interval and seat availability fields", () => {
    expect(
      parseQuery({
        kind: "office",
        from: "2099-06-10",
        to: "2099-06-12",
        startsAt: "2099-06-09T22:00:00Z",
        endsAt: "2099-06-12T22:00:00Z",
        seats: "3",
      })
    ).toEqual({
      kind: "office",
      from: "2099-06-10",
      to: "2099-06-12",
      startsAt: "2099-06-09T22:00:00Z",
      endsAt: "2099-06-12T22:00:00Z",
      seats: 3,
    });
  });

  test.each(["0", "-1", "1.5", "invalid"])(
    "drops an invalid office seat count of %s",
    (seats) => {
      const query = parseQuery({
        kind: "office",
        from: "2099-06-10",
        to: "2099-06-12",
        seats,
      });

      expect(query).not.toHaveProperty("seats");
    }
  );

  test("drops interval fields from cowork availability queries", () => {
    const query = parseQuery({
      kind: "cowork",
      date: "2099-06-10",
      from: "2099-06-10",
      to: "2099-06-10",
      startsAt: "10:00",
      endsAt: "11:00",
    });

    expect(query).toEqual({
      kind: "cowork",
      date: "2099-06-10",
      from: "2099-06-10",
      to: "2099-06-10",
    });
  });

  test.each([
    // 10:00-11:00 in Prague.
    ["hour:1", "2099-06-10T08:00:00Z", "2099-06-10T09:00:00Z", "2099-06-10"],
    // 23:00-03:00 in Prague, ending on the next date.
    ["hour:4", "2099-06-10T21:00:00Z", "2099-06-11T01:00:00Z", "2099-06-11"],
    ["day:1", "2099-06-09T22:00:00Z", "2099-06-10T22:00:00Z", "2099-06-10"],
  ])(
    "bounds a %s meeting-room interval check by the dates it touches, whatever range it names",
    (_duration, startsAt, endsAt, lastDate) => {
      for (const range of [
        {},
        { from: "2099-06-10", to: "2099-06-12" },
        { from: "2099-06-01", to: "2099-06-30" },
      ]) {
        expect(
          parseQuery({ kind: "meeting-room", ...range, startsAt, endsAt })
        ).toEqual({
          kind: "meeting-room",
          from: "2099-06-10",
          to: lastDate,
          startsAt,
          endsAt,
        });
      }
    }
  );

  test.each([
    { startsAt: "2099-06-10T08:00:00Z" },
    { endsAt: "2099-06-10T09:00:00Z" },
    { startsAt: "invalid", endsAt: "2099-06-10T09:00:00Z" },
    // Two hours, no meeting-room duration.
    { startsAt: "2099-06-10T08:00:00Z", endsAt: "2099-06-10T10:00:00Z" },
    // Three whole days.
    { startsAt: "2099-06-09T22:00:00Z", endsAt: "2099-06-12T22:00:00Z" },
  ])(
    "rejects a meeting-room interval no meeting-room duration books: %o",
    (interval) => {
      expect(
        parseWorkspaceAvailabilityQuery(
          new URLSearchParams({
            kind: "meeting-room",
            from: "2099-06-10",
            to: "2099-06-12",
            ...interval,
          })
        )
      ).toEqual(Option.none());
    }
  );
});

describe("isCoworkOfferAvailable", () => {
  const available = {
    reservedDeskWorkstationRequiredDates: [],
    unavailableCoworkTiers: [],
    unavailableDates: [],
    unavailableMonitorOptions: [],
  };

  test("accepts an offer nothing blocks", () => {
    expect(
      isCoworkOfferAvailable(available, {
        date: "2099-06-10",
        entryTier: "reserved-desk",
        monitorOption: "2x27-qhd",
      })
    ).toBe(true);
  });

  test("rejects an unavailable tier, monitor, or date", () => {
    const offer = {
      date: "2099-06-10",
      entryTier: "reserved-desk",
      monitorOption: "2x27-qhd",
    } as const;

    expect(
      isCoworkOfferAvailable(
        { ...available, unavailableCoworkTiers: ["reserved-desk"] },
        offer
      )
    ).toBe(false);
    expect(
      isCoworkOfferAvailable(
        { ...available, unavailableMonitorOptions: ["2x27-qhd"] },
        offer
      )
    ).toBe(false);
    expect(
      isCoworkOfferAvailable(
        { ...available, unavailableDates: ["2099-06-10"] },
        { date: "2099-06-10", entryTier: "open-space" }
      )
    ).toBe(false);
  });

  test("keeps a Reserved Desk on a date that only requires a workstation", () => {
    const availability = {
      ...available,
      reservedDeskWorkstationRequiredDates: ["2099-06-10"],
      unavailableDates: ["2099-06-10"],
    };

    expect(
      isCoworkOfferAvailable(availability, {
        date: "2099-06-10",
        entryTier: "reserved-desk",
      })
    ).toBe(true);
    expect(
      isCoworkOfferAvailable(availability, {
        date: "2099-06-10",
        entryTier: "open-space",
      })
    ).toBe(false);
  });
});

describe("meeting-room availability", () => {
  test("queries the interval's service dates and bounds", () => {
    expect(
      getMeetingRoomAvailabilityQuery({
        startsAt: "2099-06-09T22:00:00Z",
        endsAt: "2099-06-10T22:00:00Z",
      })
    ).toEqual({
      kind: "meeting-room",
      from: "2099-06-10",
      to: "2099-06-10",
      startsAt: "2099-06-09T22:00:00Z",
      endsAt: "2099-06-10T22:00:00Z",
    });
  });

  test("queries the selected start and duration's interval", () => {
    expect(
      getMeetingRoomSelectionAvailabilityQuery({
        duration: "hour:4",
        startDateTime: "2099-07-30T15:00",
      })
    ).toEqual({
      kind: "meeting-room",
      from: "2099-07-30",
      to: "2099-07-30",
      startsAt: "2099-07-30T13:00:00Z",
      endsAt: "2099-07-30T17:00:00Z",
    });
  });

  test("treats a blocked date or a taken room as unavailable", () => {
    const free = { meetingRoomUnavailable: false, unavailableDates: [] };

    expect(isMeetingRoomAvailable(free)).toBe(true);
    expect(
      isMeetingRoomAvailable({ ...free, meetingRoomUnavailable: true })
    ).toBe(false);
    expect(
      isMeetingRoomAvailable({ ...free, unavailableDates: ["2099-06-10"] })
    ).toBe(false);
  });
});

describe("workspace availability ranges", () => {
  // 22:30 UTC is already the next day in Prague (CEST, UTC+2).
  const beforeUtcMidnight = Temporal.Instant.from("2099-07-30T22:30:00Z");

  test("spans six months from the Prague workspace date", () => {
    const today = getCurrentWorkspaceDate(beforeUtcMidnight).toString();

    expect(today).toBe("2099-07-31");
    expect(getWorkspaceAvailabilityRange(today)).toEqual({
      from: "2099-07-31",
      to: "2100-01-31",
    });
  });

  test("matches the default range the availability route parses", () => {
    const today = getCurrentWorkspaceDate(beforeUtcMidnight).toString();
    const parsed = Option.getOrThrow(
      parseWorkspaceAvailabilityQuery(
        new URLSearchParams({ entryTier: "reserved-desk" }),
        new Date(beforeUtcMidnight.epochMilliseconds)
      )
    );

    expect(
      getCoworkAvailabilityQueries({ today, entryTier: "reserved-desk" })
    ).toEqual({ range: parsed });
  });
});

describe("getCoworkAvailabilityQueries", () => {
  const today = "2099-07-30";
  const range = { from: "2099-07-30", to: "2100-01-30" };

  test("asks for the tier's calendar range and the selected day alone", () => {
    expect(
      getCoworkAvailabilityQueries({
        today,
        entryTier: "open-space",
        date: "2099-08-02",
        monitorOption: "2x27-qhd",
      })
    ).toEqual({
      range: { kind: "cowork", ...range, entryTier: "open-space" },
      selection: {
        kind: "cowork",
        from: "2099-08-02",
        to: "2099-08-02",
        entryTier: "open-space",
        date: "2099-08-02",
      },
    });
  });

  test("adds the monitor and the bare workstation requirement for a Reserved Desk", () => {
    const bare = {
      kind: "cowork" as const,
      from: "2099-08-02",
      to: "2099-08-02",
      entryTier: "reserved-desk" as const,
      date: "2099-08-02",
    };

    expect(
      getCoworkAvailabilityQueries({
        today,
        entryTier: "reserved-desk",
        date: "2099-08-02",
        monitorOption: "2x32-qhd",
      })
    ).toEqual({
      range: { kind: "cowork", ...range, entryTier: "reserved-desk" },
      selection: { ...bare, monitorOption: "2x32-qhd" },
      workstationRequirement: bare,
    });
  });
});

describe("getOfficeAvailabilityQuery", () => {
  test("spans the office booking horizon from the workspace date", () => {
    expect(getOfficeAvailabilityQuery("2099-07-31")).toEqual({
      kind: "office",
      from: "2099-07-31",
      to: "2099-08-31",
    });
  });
});

describe("meeting-room start times", () => {
  const startTimesParams = {
    kind: "meeting-room",
    mode: "start-times",
    date: "2099-06-10",
    duration: "hour:4",
  };

  test("recognizes the start-times mode", () => {
    expect(
      isMeetingRoomStartTimesRequest(new URLSearchParams(startTimesParams))
    ).toBe(true);
    expect(
      isMeetingRoomStartTimesRequest(
        new URLSearchParams({ kind: "meeting-room", from: "2099-06-10" })
      )
    ).toBe(false);
  });

  test("parses the date and duration", () => {
    expect(
      Option.getOrUndefined(
        parseMeetingRoomStartTimesQuery(new URLSearchParams(startTimesParams))
      )
    ).toEqual({
      kind: "meeting-room",
      mode: "start-times",
      date: "2099-06-10",
      duration: "hour:4",
    });
  });

  test.each([
    { date: undefined },
    { date: "2099-02-30" },
    { date: "10.06.2099" },
    { duration: undefined },
    { duration: "hour:2" },
    { kind: "cowork" },
  ])("rejects a missing or invalid parameter: %o", (override) => {
    const params = new URLSearchParams(startTimesParams);
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }

    expect(Option.isNone(parseMeetingRoomStartTimesQuery(params))).toBe(true);
  });

  test("queries the date of the selected start", () => {
    expect(
      getMeetingRoomStartTimesQuery({
        duration: "hour:1",
        startDateTime: "2099-06-10T15:00",
      })
    ).toEqual({
      kind: "meeting-room",
      mode: "start-times",
      date: "2099-06-10",
      duration: "hour:1",
    });
    expect(
      getMeetingRoomStartTimesQuery({ duration: "hour:1", startDateTime: "" })
    ).toBeUndefined();
  });

  test("parses the start-times response", () => {
    const response = {
      date: "2099-06-10",
      duration: "hour:1",
      startTimes: [
        {
          startDateTime: "2099-06-10T09:00",
          startsAt: "2099-06-10T07:00:00Z",
          endsAt: "2099-06-10T08:00:00Z",
          earlySetupAvailable: false,
        },
      ],
    };

    expect(parseMeetingRoomStartTimesResponse(response)).toEqual(response);
    expect(() =>
      parseMeetingRoomStartTimesResponse({
        ...response,
        startTimes: [{ ...response.startTimes[0], earlySetupAvailable: "no" }],
      })
    ).toThrow();
    expect(() =>
      parseMeetingRoomStartTimesResponse({ ...response, duration: "hour:2" })
    ).toThrow();
  });
});
