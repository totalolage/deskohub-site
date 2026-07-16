import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import {
  parseWorkspaceAvailabilityQuery,
  parseWorkspaceAvailabilityResponse,
} from "./workspace-availability";

describe("parseWorkspaceAvailabilityQuery", () => {
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
      unavailableMonitorOptions: [],
      notices: [],
    });

    expect(response.unavailableCoworkTiers).toEqual(["plus"]);
    expect(response.meetingRoomUnavailable).toBe(false);
  });

  test("rejects the obsolete generic unavailableTiers field", () => {
    expect(() =>
      parseWorkspaceAvailabilityResponse({
        from: "2099-06-10",
        to: "2099-06-10",
        unavailableDates: [],
        unavailableTiers: ["plus"],
        meetingRoomUnavailable: false,
        unavailableMonitorOptions: [],
        notices: [],
      })
    ).toThrow("Invalid workspace availability response");
  });
});
