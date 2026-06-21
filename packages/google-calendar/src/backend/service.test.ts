import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { GoogleCalendarRuntimeConfig } from "../config";

let listEvents = mock(async () => ({ data: { items: [] } }));
const calendarCalls: unknown[] = [];
const jwtCalls: unknown[] = [];

mock.module("@googleapis/calendar", () => ({
  auth: {
    JWT: class {
      constructor(options: unknown) {
        jwtCalls.push(options);
      }
    },
  },
  calendar: mock((options: unknown) => {
    calendarCalls.push(options);
    return { events: { list: listEvents } };
  }),
}));

const { GoogleCalendarService } = await import("./service");

const config = {
  calendarId: "calendar-id",
  serviceAccountEmail: "service@example.test",
  privateKey: "line1\\nline2",
  timeZone: "Europe/Prague",
};

beforeEach(() => {
  listEvents = mock(async () => ({ data: { items: [] } }));
  calendarCalls.length = 0;
  jwtCalls.length = 0;
});

const runWithCalendar = <A, E>(
  effect: Effect.Effect<A, E, GoogleCalendarService>
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(GoogleCalendarService.Live),
      Effect.provide(Layer.succeed(GoogleCalendarRuntimeConfig, config))
    )
  );

describe("GoogleCalendarService", () => {
  test("paginates, expands date window, maps key newlines and events", async () => {
    listEvents = mock(async (params: { pageToken?: string }) =>
      params.pageToken
        ? {
            data: {
              items: [
                {
                  id: "event-2",
                  start: { date: "2026-06-22" },
                  end: { date: "2026-06-23" },
                },
              ],
            },
          }
        : {
            data: {
              nextPageToken: "next-page",
              items: [
                {
                  id: "event-1",
                  iCalUID: "ical-1",
                  status: "confirmed",
                  summary: "Summary",
                  description: "Description",
                  start: {
                    dateTime: "2026-06-20T10:00:00+02:00",
                    timeZone: "Europe/Prague",
                  },
                  end: { dateTime: "2026-06-20T11:00:00+02:00" },
                },
              ],
            },
          }
    );

    const result = await runWithCalendar(
      Effect.gen(function* () {
        const googleCalendar = yield* GoogleCalendarService;
        return yield* googleCalendar.listEvents({
          from: "2026-06-20",
          to: "2026-06-21",
        });
      })
    );

    expect(jwtCalls[0]).toMatchObject({
      email: "service@example.test",
      key: "line1\nline2",
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    });
    expect(calendarCalls[0]).toMatchObject({ version: "v3" });
    expect(listEvents.mock.calls[0]?.[0]).toMatchObject({
      calendarId: "calendar-id",
      maxResults: 250,
      orderBy: "startTime",
      singleEvents: true,
      timeMin: "2026-06-19T00:00:00Z",
      timeMax: "2026-06-23T00:00:00Z",
      timeZone: "Europe/Prague",
    });
    expect(listEvents.mock.calls[1]?.[0]).toMatchObject({
      pageToken: "next-page",
    });
    expect(result).toEqual([
      {
        id: "event-1",
        iCalUID: "ical-1",
        status: "confirmed",
        summary: "Summary",
        description: "Description",
        start: {
          dateTime: "2026-06-20T10:00:00+02:00",
          timeZone: "Europe/Prague",
        },
        end: { dateTime: "2026-06-20T11:00:00+02:00" },
      },
      {
        id: "event-2",
        start: { date: "2026-06-22" },
        end: { date: "2026-06-23" },
      },
    ]);
  });

  test("maps provider errors", async () => {
    listEvents = mock(async () => {
      const error = new Error("Forbidden");
      Object.assign(error, { status: 403 });
      throw error;
    });

    const result = await runWithCalendar(
      Effect.gen(function* () {
        const googleCalendar = yield* GoogleCalendarService;
        return yield* googleCalendar
          .listEvents({ from: "2026-06-20", to: "2026-06-21" })
          .pipe(Effect.result);
      })
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toMatchObject({
        _tag: "GoogleCalendarAPIError",
        operation: "events.list",
        statusCode: 403,
        message: "Forbidden",
      });
    }
  });

  test("fails empty config", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* GoogleCalendarService;
      }).pipe(
        Effect.provide(GoogleCalendarService.Live),
        Effect.provide(
          Layer.succeed(GoogleCalendarRuntimeConfig, {
            ...config,
            privateKey: "",
          })
        ),
        Effect.result
      )
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("GoogleCalendarConfigError");
    }
  });
});
