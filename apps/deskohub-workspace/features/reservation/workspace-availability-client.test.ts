import { describe, expect, mock, test } from "bun:test";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  getMeetingRoomStartTimesUrl,
  getWorkspaceAvailabilityUrl,
  loadWorkspaceAvailability,
  workspaceAvailabilityReplacementHeader,
} from "./workspace-availability-client";

describe("getWorkspaceAvailabilityUrl", () => {
  test("serializes cowork availability fields", () => {
    expect(
      getWorkspaceAvailabilityUrl({
        kind: "cowork",
        from: "2099-07-30",
        to: "2100-01-30",
        date: "2099-07-30",
        entryTier: "profi",
        monitorOption: "2x32-4k",
      })
    ).toBe(
      "/api/workspace/availability?kind=cowork&from=2099-07-30&to=2100-01-30&date=2099-07-30&entryTier=profi&monitorOption=2x32-4k"
    );
  });

  test("serializes meeting-room interval fields", () => {
    expect(
      getWorkspaceAvailabilityUrl({
        kind: "meeting-room",
        from: "2099-07-30",
        to: "2099-07-31",
        startsAt: "2099-07-30T08:00:00Z",
        endsAt: "2099-07-31T08:00:00Z",
      })
    ).toBe(
      "/api/workspace/availability?kind=meeting-room&from=2099-07-30&to=2099-07-31&startsAt=2099-07-30T08%3A00%3A00Z&endsAt=2099-07-31T08%3A00%3A00Z"
    );
  });

  test("serializes the meeting-room start-times mode", () => {
    expect(
      getMeetingRoomStartTimesUrl({
        kind: "meeting-room",
        mode: "start-times",
        date: plainDateStringSchema.make("2099-07-30"),
        duration: "hour:4",
      })
    ).toBe(
      "/api/workspace/availability?kind=meeting-room&mode=start-times&date=2099-07-30&duration=hour%3A4"
    );
  });

  test("serializes office interval and seats", () => {
    expect(
      getWorkspaceAvailabilityUrl({
        kind: "office",
        from: "2099-07-30",
        to: "2099-08-01",
        startsAt: "2099-07-29T22:00:00Z",
        endsAt: "2099-08-01T22:00:00Z",
        seats: 3,
      })
    ).toBe(
      "/api/workspace/availability?kind=office&from=2099-07-30&to=2099-08-01&startsAt=2099-07-29T22%3A00%3A00Z&endsAt=2099-08-01T22%3A00%3A00Z&seats=3"
    );
  });

  test("transports replacement state outside the public availability query", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock(() =>
      Promise.resolve(
        Response.json({
          date: "2099-07-30",
          from: "2099-07-30",
          to: "2099-07-30",
          unavailableDates: [],
          reservedDeskWorkstationRequiredDates: [],
          unavailableCoworkTiers: [],
          meetingRoomUnavailable: false,
          officeUnavailable: false,
          unavailableMonitorOptions: [],
          notices: [],
        })
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await loadWorkspaceAvailability({
        query: {
          kind: "cowork",
          from: "2099-07-30",
          to: "2099-07-30",
          date: "2099-07-30",
          entryTier: "basic",
        },
        replacementToken: "signed-restored-checkout-state",
        signal: new AbortController().signal,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).not.toContain("signed-restored-checkout-state");
    expect(
      new Headers(init?.headers).get(workspaceAvailabilityReplacementHeader)
    ).toBe("signed-restored-checkout-state");
  });
});
