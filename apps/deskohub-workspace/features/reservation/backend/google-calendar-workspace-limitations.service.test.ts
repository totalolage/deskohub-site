import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import {
  GoogleCalendarAPIError,
  type GoogleCalendarError,
  type GoogleCalendarEvent,
  type GoogleCalendarListEventsInput,
} from "@deskohub/google-calendar";
import { GoogleCalendarServiceMock } from "@deskohub/google-calendar/backend/service.mock";
import { Effect, Layer, Schema } from "effect";
import {
  CalendarResourceConfig,
  salesCalendarIdSchema,
  workspaceLimitationsCalendarIdSchema,
} from "@/shared/backend/config/calendar-resource.config";
import {
  GoogleCalendarWorkspaceLimitationsService,
  WorkspaceCalendarLimitation,
} from "./google-calendar-workspace-limitations.service";

const workspaceLimitationsCalendarId = Schema.decodeUnknownSync(
  workspaceLimitationsCalendarIdSchema
)("workspace-limitations-calendar");
const salesCalendarId = Schema.decodeUnknownSync(salesCalendarIdSchema)(
  "sales-calendar"
);

const defaultQuery = { from: "2026-06-10", to: "2026-06-11" };

const listLimitations = (
  listEvents: (
    input: GoogleCalendarListEventsInput
  ) => Effect.Effect<GoogleCalendarEvent[], GoogleCalendarError>,
  query = defaultQuery
) =>
  Effect.gen(function* () {
    const service = yield* GoogleCalendarWorkspaceLimitationsService;
    return yield* service.listLimitations(query);
  }).pipe(
    Effect.provide(
      GoogleCalendarWorkspaceLimitationsService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            GoogleCalendarServiceMock({ listEvents: mock(listEvents) }),
            Layer.succeed(CalendarResourceConfig, {
              workspaceLimitationsCalendarId,
              salesCalendarId,
            })
          )
        )
      )
    )
  );

const runWithEvents = async (
  events: readonly GoogleCalendarEvent[],
  query = defaultQuery,
  onListEvents?: (input: GoogleCalendarListEventsInput) => void
) =>
  listLimitations((input) => {
    onListEvents?.(input);
    return Effect.succeed([...events]);
  }, query).pipe(Effect.runPromise);

const fullDayOn10June = {
  start: { date: "2026-06-10" },
  end: { date: "2026-06-11" },
} satisfies Pick<GoogleCalendarEvent, "start" | "end">;

describe("GoogleCalendarWorkspaceLimitationsService", () => {
  test("translates description markers into workspace limitations", async () => {
    const limitations = await runWithEvents([
      {
        id: "partial-event",
        status: "confirmed",
        summary: "Community meetup",
        description: "[workspace:partial]",
        start: {
          dateTime: "2026-06-10T12:00:00+02:00",
          timeZone: "Europe/Prague",
        },
        end: {
          dateTime: "2026-06-10T13:00:00+02:00",
          timeZone: "Europe/Prague",
        },
      },
      {
        id: "full-event",
        status: "confirmed",
        summary: "Closed for maintenance",
        description: "Internal note [workspace:full]",
        start: {
          dateTime: "2026-06-11T12:00:00+02:00",
          timeZone: "Europe/Prague",
        },
        end: {
          dateTime: "2026-06-11T13:00:00+02:00",
          timeZone: "Europe/Prague",
        },
      },
    ]);

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.PartiallyOccupied({
        date: "2026-06-10",
        startsAt: "12:00",
        endsAt: "13:00",
        sourceEventId: "partial-event",
        summary: "Community meetup",
      }),
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-11",
        sourceEventId: "full-event",
        summary: "Closed for maintenance",
      }),
    ]);
  });

  test("ignores usage markers outside event descriptions", async () => {
    const limitations = await runWithEvents([
      {
        id: "title-only-marker",
        status: "confirmed",
        summary: "[workspace:full]",
        start: { date: "2026-06-11" },
        end: { date: "2026-06-12" },
      },
    ]);

    expect(limitations).toEqual([]);
  });

  test("keeps each occupied day before a multi-day timed event ends at midnight", async () => {
    const limitations = await runWithEvents(
      [
        {
          id: "multi-day-full-midnight-event",
          status: "confirmed",
          description: "[workspace:full]",
          start: {
            dateTime: "2026-06-10T12:00:00+02:00",
            timeZone: "Europe/Prague",
          },
          end: {
            dateTime: "2026-06-12T00:00:00+02:00",
            timeZone: "Europe/Prague",
          },
        },
      ],
      { from: "2026-06-10", to: "2026-06-12" }
    );

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-10",
        sourceEventId: "multi-day-full-midnight-event",
      }),
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-11",
        sourceEventId: "multi-day-full-midnight-event",
      }),
    ]);
  });

  test("reads offset-less event times in the event time zone", async () => {
    const limitations = await runWithEvents(
      [
        {
          id: "offset-less-midnight-event",
          status: "confirmed",
          description: "[workspace:full]",
          start: {
            dateTime: "2026-06-10T12:00:00",
            timeZone: "Europe/Prague",
          },
          end: {
            dateTime: "2026-06-11T00:00:00",
            timeZone: "Europe/Prague",
          },
        },
      ],
      { from: "2026-06-10", to: "2026-06-11" }
    );

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-10",
        sourceEventId: "offset-less-midnight-event",
      }),
    ]);
  });

  test("treats midnight in Prague as end-exclusive", async () => {
    const limitations = await runWithEvents(
      [
        {
          id: "prague-midnight-event",
          status: "confirmed",
          description: "[workspace:full]",
          start: {
            dateTime: "2026-06-10T10:00:00Z",
          },
          end: {
            dateTime: "2026-06-10T22:00:00Z",
          },
        },
      ],
      { from: "2026-06-10", to: "2026-06-11" }
    );

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-10",
        sourceEventId: "prague-midnight-event",
      }),
    ]);
  });

  test("keeps the end day for timed events ending seconds after midnight", async () => {
    const limitations = await runWithEvents(
      [
        {
          id: "seconds-after-midnight-event",
          status: "confirmed",
          description: "[workspace:full]",
          start: {
            dateTime: "2026-06-10T12:00:00+02:00",
            timeZone: "Europe/Prague",
          },
          end: {
            dateTime: "2026-06-12T00:00:30+02:00",
            timeZone: "Europe/Prague",
          },
        },
      ],
      { from: "2026-06-10", to: "2026-06-12" }
    );

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-10",
        sourceEventId: "seconds-after-midnight-event",
      }),
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-11",
        sourceEventId: "seconds-after-midnight-event",
      }),
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-12",
        sourceEventId: "seconds-after-midnight-event",
      }),
    ]);
  });

  test("keeps all-day events end-exclusive", async () => {
    const limitations = await runWithEvents(
      [
        {
          id: "all-day-full-event",
          status: "confirmed",
          description: "[workspace:full]",
          start: { date: "2026-06-10" },
          end: { date: "2026-06-12" },
        },
      ],
      { from: "2026-06-10", to: "2026-06-12" }
    );

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-10",
        sourceEventId: "all-day-full-event",
      }),
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-11",
        sourceEventId: "all-day-full-event",
      }),
    ]);
  });

  test("skips cancelled events and events without an id", async () => {
    const limitations = await runWithEvents([
      {
        id: "cancelled-event",
        status: "cancelled",
        description: "[workspace:full]",
        ...fullDayOn10June,
      },
      {
        status: "confirmed",
        description: "[workspace:full]",
        ...fullDayOn10June,
      },
    ]);

    expect(limitations).toEqual([]);
  });

  test("falls back to the iCalendar UID and drops a blank summary", async () => {
    const limitations = await runWithEvents([
      {
        iCalUID: "ical-event-uid",
        status: "confirmed",
        summary: "   ",
        description: "  [WORKSPACE:FULL]  ",
        ...fullDayOn10June,
      },
    ]);

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-10",
        sourceEventId: "ical-event-uid",
      }),
    ]);
  });

  test("prefers the event id and trims the summary", async () => {
    const limitations = await runWithEvents([
      {
        id: "event-id",
        iCalUID: "ical-event-uid",
        status: "confirmed",
        summary: "  Closed  ",
        description: "[workspace:full]",
        ...fullDayOn10June,
      },
    ]);

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-10",
        sourceEventId: "event-id",
        summary: "Closed",
      }),
    ]);
  });

  test("treats an event marked both full and partial as full", async () => {
    const limitations = await runWithEvents([
      {
        id: "both-markers",
        status: "confirmed",
        description: "[workspace:partial] [workspace:full]",
        start: { dateTime: "2026-06-10T12:00:00+02:00" },
        end: { dateTime: "2026-06-10T13:00:00+02:00" },
      },
    ]);

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-10",
        sourceEventId: "both-markers",
      }),
    ]);
  });

  test("ignores events without a marker or a description", async () => {
    const limitations = await runWithEvents([
      {
        id: "unmarked-event",
        status: "confirmed",
        description: "Team lunch",
        ...fullDayOn10June,
      },
      { id: "undescribed-event", status: "confirmed", ...fullDayOn10June },
    ]);

    expect(limitations).toEqual([]);
  });

  test("ignores partial events without start and end times", async () => {
    const limitations = await runWithEvents([
      {
        id: "all-day-partial-event",
        status: "confirmed",
        description: "[workspace:partial]",
        ...fullDayOn10June,
      },
      {
        id: "open-ended-partial-event",
        status: "confirmed",
        description: "[workspace:partial]",
        start: { dateTime: "2026-06-10T12:00:00+02:00" },
      },
    ]);

    expect(limitations).toEqual([]);
  });

  test("occupies the start day of a full event without an end", async () => {
    const limitations = await runWithEvents([
      {
        id: "open-ended-full-event",
        status: "confirmed",
        description: "[workspace:full]",
        start: { dateTime: "2026-06-11T12:00:00+02:00" },
      },
      {
        id: "unscheduled-full-event",
        status: "confirmed",
        description: "[workspace:full]",
      },
    ]);

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-11",
        sourceEventId: "open-ended-full-event",
      }),
    ]);
  });

  test("drops limitations outside the queried range", async () => {
    const limitations = await runWithEvents(
      [
        {
          id: "long-full-event",
          status: "confirmed",
          description: "[workspace:full]",
          start: { date: "2026-06-09" },
          end: { date: "2026-06-13" },
        },
      ],
      { from: "2026-06-10", to: "2026-06-11" }
    );

    expect(limitations.map(({ date }) => date)).toEqual([
      "2026-06-10",
      "2026-06-11",
    ]);
  });

  test("reads the limitations calendar for the queried range", async () => {
    const requests: GoogleCalendarListEventsInput[] = [];
    await runWithEvents([], defaultQuery, (input) => requests.push(input));

    expect(requests).toEqual([
      { ...defaultQuery, calendarId: workspaceLimitationsCalendarId },
    ]);
  });

  test("fails with the calendar error when the events can't be read", async () => {
    const failure = new GoogleCalendarAPIError({
      operation: "listEvents",
      statusCode: 503,
    });

    const error = await listLimitations(() => Effect.fail(failure)).pipe(
      Effect.flip,
      Effect.runPromise
    );

    expect(error).toBe(failure);
  });
});
