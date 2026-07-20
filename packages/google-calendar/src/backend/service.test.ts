import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { GoogleCalendarRuntimeConfig } from "../config";

type CalendarListQuery = {
  readonly calendarId: string;
  readonly pageToken?: string;
  readonly [key: string]: unknown;
};

type CalendarListResponse = {
  readonly data: {
    readonly items: readonly unknown[];
    readonly nextPageToken?: string;
  };
};

type ListEventsImplementation = (
  params: CalendarListQuery
) => Promise<CalendarListResponse>;

let listEvents = mock<ListEventsImplementation>(async () => ({
  data: { items: [] },
}));
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

type GoogleCalendarRequirement = import("./service").GoogleCalendarService;

const config = {
  serviceAccountEmail: "service@example.test",
  privateKey: "line1\\nline2",
  timeZone: "Europe/Prague",
};

beforeEach(() => {
  listEvents = mock<ListEventsImplementation>(async () => ({
    data: { items: [] },
  }));
  calendarCalls.length = 0;
  jwtCalls.length = 0;
});

const runWithCalendar = <A, E>(
  effect: Effect.Effect<A, E, GoogleCalendarRequirement>
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        GoogleCalendarService.Live.pipe(
          Layer.provide(Layer.succeed(GoogleCalendarRuntimeConfig, config))
        )
      )
    )
  );

describe("GoogleCalendarService", () => {
  test("paginates, expands date window, maps key newlines and events", async () => {
    listEvents = mock<ListEventsImplementation>(async (params) =>
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
                  recurringEventId: "recurring-event-1",
                  status: "confirmed",
                  summary: "Summary",
                  description: "Description",
                  start: {
                    dateTime: "2026-06-20T10:00:00+02:00",
                    timeZone: "Europe/Prague",
                  },
                  end: { dateTime: "2026-06-20T11:00:00+02:00" },
                  originalStartTime: {
                    dateTime: "2026-06-20T09:00:00+02:00",
                    timeZone: "Europe/Prague",
                  },
                },
              ],
            },
          }
    );

    const result = await runWithCalendar(
      Effect.gen(function* () {
        const googleCalendar = yield* GoogleCalendarService;
        return yield* googleCalendar.listEvents({
          calendarId: "calendar-id",
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
      calendarId: "calendar-id",
      pageToken: "next-page",
    });
    expect(result).toEqual([
      {
        id: "event-1",
        iCalUID: "ical-1",
        recurringEventId: "recurring-event-1",
        status: "confirmed",
        summary: "Summary",
        description: "Description",
        start: {
          dateTime: "2026-06-20T10:00:00+02:00",
          timeZone: "Europe/Prague",
        },
        end: { dateTime: "2026-06-20T11:00:00+02:00" },
        originalStartTime: {
          dateTime: "2026-06-20T09:00:00+02:00",
          timeZone: "Europe/Prague",
        },
      },
      {
        id: "event-2",
        start: { date: "2026-06-22" },
        end: { date: "2026-06-23" },
      },
    ]);
  });

  test("keeps concurrent paginated resource calendars isolated", async () => {
    listEvents = mock<ListEventsImplementation>(async (params) => ({
      data: {
        items: [
          {
            id: `${params.calendarId}-${params.pageToken ? "second" : "first"}`,
          },
        ],
        ...(!params.pageToken && {
          nextPageToken: `${params.calendarId}-next-page`,
        }),
      },
    }));

    const [workspaceEvents, salesEvents] = await runWithCalendar(
      Effect.gen(function* () {
        const googleCalendar = yield* GoogleCalendarService;

        return yield* Effect.all([
          googleCalendar.listEvents({
            calendarId: "workspace-limitations-calendar",
            from: "2026-06-20",
            to: "2026-06-21",
          }),
          googleCalendar.listEvents({
            calendarId: "sales-calendar",
            from: "2026-06-20",
            to: "2026-06-21",
          }),
        ]);
      })
    );

    expect(workspaceEvents.map(({ id }) => id)).toEqual([
      "workspace-limitations-calendar-first",
      "workspace-limitations-calendar-second",
    ]);
    expect(salesEvents.map(({ id }) => id)).toEqual([
      "sales-calendar-first",
      "sales-calendar-second",
    ]);
    expect(listEvents).toHaveBeenCalledTimes(4);
    expect(
      listEvents.mock.calls.map(([query]) => ({
        calendarId: query.calendarId,
        pageToken: query.pageToken,
      }))
    ).toEqual(
      expect.arrayContaining([
        {
          calendarId: "workspace-limitations-calendar",
          pageToken: undefined,
        },
        {
          calendarId: "workspace-limitations-calendar",
          pageToken: "workspace-limitations-calendar-next-page",
        },
        { calendarId: "sales-calendar", pageToken: undefined },
        {
          calendarId: "sales-calendar",
          pageToken: "sales-calendar-next-page",
        },
      ])
    );
  });

  test("maps provider errors", async () => {
    listEvents = mock<ListEventsImplementation>(async () => {
      const error = new Error("Forbidden");
      Object.assign(error, { status: 403 });
      throw error;
    });

    const result = await runWithCalendar(
      Effect.gen(function* () {
        const googleCalendar = yield* GoogleCalendarService;
        return yield* googleCalendar
          .listEvents({
            calendarId: "calendar-id",
            from: "2026-06-20",
            to: "2026-06-21",
          })
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
      GoogleCalendarService.pipe(
        Effect.provide(
          GoogleCalendarService.Live.pipe(
            Layer.provide(
              Layer.succeed(GoogleCalendarRuntimeConfig, {
                ...config,
                privateKey: "",
              })
            )
          )
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
