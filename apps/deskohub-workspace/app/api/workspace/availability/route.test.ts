import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ValidationError } from "@deskohub/dotypos";
import { Data, Effect, Layer } from "effect";

class SyntheticAvailabilityOutage extends Data.TaggedError(
  "SyntheticAvailabilityOutage"
)<{ readonly message: string }> {}

let availabilityFailure: ValidationError | SyntheticAvailabilityOutage | null =
  null;
const loadedAvailabilityQueries: unknown[] = [];
const loadedStartTimesQueries: unknown[] = [];
const syntheticStartTimes = {
  date: "2099-06-10",
  duration: "hour:1",
  startTimes: [
    {
      startDateTime: "2099-06-10T09:00",
      startsAt: "2099-06-10T07:00:00Z",
      endsAt: "2099-06-10T08:00:00Z",
    },
  ],
};

mock.module(
  "@/features/reservation/backend/workspace-availability-loader",
  () => ({
    WorkspaceAvailabilityLoaderLive: Layer.empty,
    loadAvailability: (request: { readonly query: unknown }) => {
      loadedAvailabilityQueries.push(request.query);
      return availabilityFailure
        ? Effect.fail(availabilityFailure)
        : Effect.succeed({ unavailableDates: [] });
    },
    loadMeetingRoomStartTimes: (request: { readonly query: unknown }) => {
      loadedStartTimesQueries.push(request.query);
      return availabilityFailure
        ? Effect.fail(availabilityFailure)
        : Effect.succeed(syntheticStartTimes);
    },
  })
);

const requestUrl =
  "https://workspace.test/api/workspace/availability?kind=cowork";

const loadRoute = async () =>
  (await import("./route")) as {
    GET: (request: Request) => Promise<Response>;
  };

describe("workspace availability route", () => {
  beforeEach(() => {
    availabilityFailure = null;
    loadedAvailabilityQueries.length = 0;
    loadedStartTimesQueries.length = 0;
  });

  test("returns availability without caching it", async () => {
    const { GET } = await loadRoute();
    const response = await GET(new Request(requestUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ unavailableDates: [] });
  });

  test("answers a validation failure with 400 and its message", async () => {
    availabilityFailure = new ValidationError({
      message: "Synthetic availability query is invalid",
    });
    const { GET } = await loadRoute();
    const response = await GET(new Request(requestUrl));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Synthetic availability query is invalid",
    });
  });

  test("answers any other failure with a generic 500", async () => {
    availabilityFailure = new SyntheticAvailabilityOutage({
      message: "synthetic provider outage detail",
    });
    const { GET } = await loadRoute();
    const response = await GET(new Request(requestUrl));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Workspace availability could not be loaded",
    });
  });

  describe("meeting-room interval mode", () => {
    const intervalUrl = (params: Record<string, string>) =>
      `https://workspace.test/api/workspace/availability?${new URLSearchParams({
        kind: "meeting-room",
        ...params,
      }).toString()}`;

    test("checks the dates the interval touches instead of the named range", async () => {
      const { GET } = await loadRoute();
      const response = await GET(
        new Request(
          intervalUrl({
            from: "2099-06-10",
            to: "2099-06-12",
            // 23:00-03:00 in Prague.
            startsAt: "2099-06-10T21:00:00Z",
            endsAt: "2099-06-11T01:00:00Z",
          })
        )
      );

      expect(response.status).toBe(200);
      expect(loadedAvailabilityQueries).toEqual([
        {
          kind: "meeting-room",
          from: "2099-06-10",
          to: "2099-06-11",
          startsAt: "2099-06-10T21:00:00Z",
          endsAt: "2099-06-11T01:00:00Z",
        },
      ]);
    });

    test("answers an interval no meeting-room duration books with 400", async () => {
      const { GET } = await loadRoute();
      const response = await GET(
        new Request(
          intervalUrl({
            from: "2099-06-10",
            to: "2099-06-12",
            startsAt: "2099-06-09T22:00:00Z",
            endsAt: "2099-06-12T22:00:00Z",
          })
        )
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error:
          "Meeting-room availability needs startsAt and endsAt of one meeting-room booking of 1 hour, 4 hours, or a whole day.",
      });
      expect(loadedAvailabilityQueries).toEqual([]);
    });
  });

  describe("meeting-room start-times mode", () => {
    const startTimesUrl = (params: Record<string, string>) =>
      `https://workspace.test/api/workspace/availability?${new URLSearchParams({
        kind: "meeting-room",
        mode: "start-times",
        ...params,
      }).toString()}`;

    test("returns the free start times for the date and duration", async () => {
      const { GET } = await loadRoute();
      const response = await GET(
        new Request(startTimesUrl({ date: "2099-06-10", duration: "hour:1" }))
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      await expect(response.json()).resolves.toEqual(syntheticStartTimes);
      expect(loadedStartTimesQueries).toEqual([
        {
          kind: "meeting-room",
          mode: "start-times",
          date: "2099-06-10",
          duration: "hour:1",
        },
      ]);
    });

    test.each([
      { duration: "hour:1" },
      { date: "2099-06-31", duration: "hour:1" },
      { date: "2099-06-10" },
      { date: "2099-06-10", duration: "hour:2" },
      { date: "2099-06-10", duration: "hour:1", kind: "office" },
    ])("answers missing or invalid parameters with 400: %o", async (params) => {
      const { GET } = await loadRoute();
      const response = await GET(new Request(startTimesUrl(params)));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error:
          "Meeting-room start times need kind=meeting-room, a YYYY-MM-DD date, and a duration of hour:1, hour:4, or day:1.",
      });
      expect(loadedStartTimesQueries).toEqual([]);
    });

    test("answers a loading failure with a generic 500", async () => {
      availabilityFailure = new SyntheticAvailabilityOutage({
        message: "synthetic provider outage detail",
      });
      const { GET } = await loadRoute();
      const response = await GET(
        new Request(startTimesUrl({ date: "2099-06-10", duration: "day:1" }))
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Workspace availability could not be loaded",
      });
    });
  });
});
