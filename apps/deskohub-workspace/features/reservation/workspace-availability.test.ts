import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import {
  getMeetingRoomAvailabilityQuery,
  isCoworkOfferAvailable,
  isMeetingRoomAvailable,
  parseWorkspaceAvailabilityQuery,
  parseWorkspaceAvailabilityResponse,
} from "./workspace-availability";

describe("parseWorkspaceAvailabilityQuery", () => {
  test("derives default dates from the configured Workspace timezone", () => {
    const query = parseWorkspaceAvailabilityQuery(
      new URLSearchParams(),
      new Date("2026-07-19T22:30:00Z")
    );

    expect(query).toMatchObject({
      from: "2026-07-20",
      to: "2027-01-20",
    });
  });

  test("keeps the public kind query param as the domain discriminator", () => {
    const query = parseWorkspaceAvailabilityQuery(
      new URLSearchParams({
        kind: "meeting-room",
        from: "2099-06-10",
        to: "2099-06-10",
      })
    );

    expect(query).toMatchObject({
      kind: "meeting-room",
      from: "2099-06-10",
      to: "2099-06-10",
    });
    expect(query).not.toHaveProperty("date");
  });

  test("does not treat meeting room as a cowork entry tier", () => {
    const query = parseWorkspaceAvailabilityQuery(
      new URLSearchParams({
        entryTier: "meeting-room",
        from: "2099-06-10",
        to: "2099-06-10",
      })
    );

    expect(query).toEqual({
      kind: "cowork",
      from: "2099-06-10",
      to: "2099-06-10",
    });
  });

  test("parses office interval and seat availability fields", () => {
    expect(
      parseWorkspaceAvailabilityQuery(
        new URLSearchParams({
          kind: "office",
          from: "2099-06-10",
          to: "2099-06-12",
          startsAt: "2099-06-09T22:00:00Z",
          endsAt: "2099-06-12T22:00:00Z",
          seats: "3",
        })
      )
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
      const query = parseWorkspaceAvailabilityQuery(
        new URLSearchParams({
          kind: "office",
          from: "2099-06-10",
          to: "2099-06-12",
          seats,
        })
      );

      expect(query).not.toHaveProperty("seats");
    }
  );

  test("drops interval fields from cowork availability queries", () => {
    const query = parseWorkspaceAvailabilityQuery(
      new URLSearchParams({
        kind: "cowork",
        date: "2099-06-10",
        from: "2099-06-10",
        to: "2099-06-10",
        startsAt: "10:00",
        endsAt: "11:00",
      })
    );

    expect(query).toEqual({
      kind: "cowork",
      date: "2099-06-10",
      from: "2099-06-10",
      to: "2099-06-10",
    });
  });
});

describe("parseWorkspaceAvailabilityResponse", () => {
  test("uses the cowork-specific tier field consumed by the reservation form", () => {
    const response = parseWorkspaceAvailabilityResponse({
      date: "2099-06-10",
      from: "2099-06-10",
      to: "2099-06-10",
      unavailableDates: [],
      reservedDeskWorkstationRequiredDates: ["2099-06-10"],
      unavailableCoworkTiers: ["plus"],
      meetingRoomUnavailable: false,
      officeUnavailable: false,
      unavailableMonitorOptions: [],
      notices: [],
    });

    expect(response.reservedDeskWorkstationRequiredDates).toEqual([
      "2099-06-10",
    ]);
    expect(response.unavailableCoworkTiers).toEqual(["plus"]);
    expect(response.meetingRoomUnavailable).toBe(false);
    expect(response.officeUnavailable).toBe(false);
  });

  test("rejects the obsolete generic unavailableTiers field", () => {
    expect(() =>
      parseWorkspaceAvailabilityResponse({
        from: "2099-06-10",
        to: "2099-06-10",
        unavailableDates: [],
        reservedDeskWorkstationRequiredDates: [],
        unavailableTiers: ["plus"],
        meetingRoomUnavailable: false,
        officeUnavailable: false,
        unavailableMonitorOptions: [],
        notices: [],
      })
    ).toThrow("Invalid workspace availability response");
  });

  test("rejects responses without reserved-desk workstation requirement dates", () => {
    expect(() =>
      parseWorkspaceAvailabilityResponse({
        from: "2099-06-10",
        to: "2099-06-10",
        unavailableDates: [],
        unavailableCoworkTiers: [],
        meetingRoomUnavailable: false,
        officeUnavailable: false,
        unavailableMonitorOptions: [],
        notices: [],
      })
    ).toThrow("Invalid workspace availability response");
  });
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
