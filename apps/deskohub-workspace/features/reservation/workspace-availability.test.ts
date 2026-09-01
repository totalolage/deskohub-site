import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import {
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
      unavailableCoworkTiers: ["plus"],
      meetingRoomUnavailable: false,
      officeUnavailable: false,
      unavailableMonitorOptions: [],
      notices: [],
    });

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
        unavailableTiers: ["plus"],
        meetingRoomUnavailable: false,
        officeUnavailable: false,
        unavailableMonitorOptions: [],
        notices: [],
      })
    ).toThrow("Invalid workspace availability response");
  });
});
