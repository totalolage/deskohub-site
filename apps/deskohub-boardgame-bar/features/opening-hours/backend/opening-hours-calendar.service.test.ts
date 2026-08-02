import { describe, expect, mock, test } from "bun:test";
import type {
  GoogleCalendarEvent,
  GoogleCalendarListEventsInput,
  GoogleCalendarWatchEventsInput,
} from "@deskohub/google-calendar";
import { GoogleCalendarServiceMock } from "@deskohub/google-calendar/backend/service.mock";
import { Effect, Layer } from "effect";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";

setBoardgameTestEnv();

type OpeningHoursExceptionQuery = {
  readonly from: string;
  readonly to: string;
  readonly now: string;
};

const defaultQuery = {
  from: "2026-08-02",
  to: "2026-08-10",
  now: "2026-08-02T10:00:00Z",
} satisfies OpeningHoursExceptionQuery;

const runWithEvents = async (
  events: readonly GoogleCalendarEvent[],
  query = defaultQuery,
  onListEvents?: (input: GoogleCalendarListEventsInput) => void
) => {
  const [{ OpeningHoursCalendarConfig }, { OpeningHoursCalendarService }] =
    await Promise.all([
      import("./opening-hours-calendar.config"),
      import("./opening-hours-calendar.service"),
    ]);

  return Effect.gen(function* () {
    const service = yield* OpeningHoursCalendarService;
    return yield* service.listExceptions(query);
  }).pipe(
    Effect.provide(
      OpeningHoursCalendarService.Live.pipe(
        Layer.provide(
          Layer.mergeAll(
            GoogleCalendarServiceMock({
              listEvents: mock((input) => {
                onListEvents?.(input);
                return Effect.succeed([...events]);
              }),
            }),
            Layer.succeed(OpeningHoursCalendarConfig, {
              calendarId: "opening-hours-calendar",
            })
          )
        )
      )
    ),
    Effect.runPromise
  );
};

describe("OpeningHoursCalendarService", () => {
  test("watches the configured opening-hours calendar", async () => {
    const watchInputs: GoogleCalendarWatchEventsInput[] = [];
    const [{ OpeningHoursCalendarConfig }, { OpeningHoursCalendarService }] =
      await Promise.all([
        import("./opening-hours-calendar.config"),
        import("./opening-hours-calendar.service"),
      ]);

    const channel = await Effect.gen(function* () {
      const service = yield* OpeningHoursCalendarService;
      return yield* service.watchChanges({
        channelId: "channel-id",
        webhookUrl: "https://bar.example.test/webhook",
        webhookToken: "derived-token",
        ttlSeconds: 259_200,
      });
    }).pipe(
      Effect.provide(
        OpeningHoursCalendarService.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              GoogleCalendarServiceMock({
                watchEvents: mock((input) => {
                  watchInputs.push(input);
                  return Effect.succeed({ channelId: input.channelId });
                }),
              }),
              Layer.succeed(OpeningHoursCalendarConfig, {
                calendarId: "opening-hours-calendar",
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(watchInputs).toEqual([
      {
        calendarId: "opening-hours-calendar",
        channelId: "channel-id",
        webhookUrl: "https://bar.example.test/webhook",
        webhookToken: "derived-token",
        ttlSeconds: 259_200,
      },
    ]);
    expect(channel).toEqual({ channelId: "channel-id" });
  });

  test("loads the configured resource and translates marked events", async () => {
    const inputs: GoogleCalendarListEventsInput[] = [];
    const exceptions = await runWithEvents(
      [
        {
          id: "planning-only",
          summary: "Private event planning",
          start: { date: "2026-08-03" },
          end: { date: "2026-08-04" },
        },
        {
          id: "cancelled",
          status: "cancelled",
          description: "[bar:closed]",
          start: { date: "2026-08-03" },
          end: { date: "2026-08-04" },
        },
        {
          id: "closed",
          description: "Holiday [bar:closed]",
          start: { date: "2026-08-04" },
          end: { date: "2026-08-06" },
        },
        {
          id: "special-hours",
          description: "<p>[BAR:HOURS]</p>",
          start: {
            dateTime: "2026-08-07T12:00:00+02:00",
            timeZone: "Europe/Prague",
          },
          end: {
            dateTime: "2026-08-07T20:30:00+02:00",
            timeZone: "Europe/Prague",
          },
        },
      ],
      defaultQuery,
      (input) => inputs.push(input)
    );

    expect(inputs).toEqual([
      {
        calendarId: "opening-hours-calendar",
        from: defaultQuery.from,
        to: defaultQuery.to,
      },
    ]);
    expect(exceptions).toEqual([
      {
        _tag: "Closed",
        date: "2026-08-04",
        sourceEventReference: "closed",
      },
      {
        _tag: "Closed",
        date: "2026-08-05",
        sourceEventReference: "closed",
      },
      {
        _tag: "SpecialHours",
        date: "2026-08-07",
        opensAt: "12:00",
        closesAt: "20:30",
        closesNextDay: false,
        ongoing: false,
        sourceEventReference: "special-hours",
      },
    ]);
  });

  test("uses Prague-local dates and supports cross-midnight opening hours", async () => {
    const exceptions = await runWithEvents([
      {
        id: "offset-crosses-date",
        description: "[bar:hours]",
        start: { dateTime: "2026-08-02T22:30:00Z" },
        end: { dateTime: "2026-08-03T03:00:00Z" },
      },
      {
        id: "floating-time",
        description: "[bar:hours]",
        start: {
          dateTime: "2026-08-08T20:00:00",
          timeZone: "Europe/Prague",
        },
        end: {
          dateTime: "2026-08-09T02:00:00",
          timeZone: "Europe/Prague",
        },
      },
    ]);

    expect(exceptions).toEqual([
      {
        _tag: "SpecialHours",
        date: "2026-08-03",
        opensAt: "00:30",
        closesAt: "05:00",
        closesNextDay: false,
        ongoing: false,
        sourceEventReference: "offset-crosses-date",
      },
      {
        _tag: "SpecialHours",
        date: "2026-08-08",
        opensAt: "20:00",
        closesAt: "02:00",
        closesNextDay: true,
        ongoing: false,
        sourceEventReference: "floating-time",
      },
    ]);
  });

  test("uses Prague-local clock times across daylight-saving changes", async () => {
    const exceptions = await runWithEvents(
      [
        {
          id: "dst-transition",
          description: "[bar:hours]",
          start: { dateTime: "2026-03-29T00:30:00Z" },
          end: { dateTime: "2026-03-29T02:30:00Z" },
        },
      ],
      {
        from: "2026-03-29",
        to: "2026-03-29",
        now: "2026-03-28T10:00:00Z",
      }
    );

    expect(exceptions).toEqual([
      {
        _tag: "SpecialHours",
        date: "2026-03-29",
        opensAt: "01:30",
        closesAt: "04:30",
        closesNextDay: false,
        ongoing: false,
        sourceEventReference: "dst-transition",
      },
    ]);
  });

  test("keeps ongoing hours and removes ended or padded events", async () => {
    const query = {
      from: "2026-08-09",
      to: "2026-08-10",
      now: "2026-08-08T22:30:00Z",
    } satisfies OpeningHoursExceptionQuery;
    const exceptions = await runWithEvents(
      [
        {
          id: "ongoing",
          description: "[bar:hours]",
          start: { dateTime: "2026-08-08T20:00:00+02:00" },
          end: { dateTime: "2026-08-09T02:00:00+02:00" },
        },
        {
          id: "ended",
          description: "[bar:hours]",
          start: { dateTime: "2026-08-09T00:00:00+02:00" },
          end: { dateTime: "2026-08-09T00:15:00+02:00" },
        },
        {
          id: "outside-padded-window",
          description: "[bar:hours]",
          start: { dateTime: "2026-08-11T12:00:00+02:00" },
          end: { dateTime: "2026-08-11T20:00:00+02:00" },
        },
      ],
      query
    );

    expect(exceptions).toEqual([
      {
        _tag: "SpecialHours",
        date: "2026-08-08",
        opensAt: "20:00",
        closesAt: "02:00",
        closesNextDay: true,
        ongoing: true,
        sourceEventReference: "ongoing",
      },
    ]);
  });

  test("ignores no-op and malformed events without dropping valid events", async () => {
    const exceptions = await runWithEvents([
      {
        id: "regular-monday-hours",
        description: "[bar:hours]",
        start: { dateTime: "2026-08-03T17:00:00+02:00" },
        end: { dateTime: "2026-08-03T23:00:00+02:00" },
      },
      {
        id: "conflicting-markers",
        description: "[bar:closed] [bar:hours]",
        start: { date: "2026-08-04" },
        end: { date: "2026-08-05" },
      },
      {
        id: "closed-but-timed",
        description: "[bar:closed]",
        start: { dateTime: "2026-08-05T12:00:00+02:00" },
        end: { dateTime: "2026-08-05T13:00:00+02:00" },
      },
      {
        description: "[bar:closed]",
        start: { date: "2026-08-06" },
        end: { date: "2026-08-07" },
      },
      {
        id: "valid",
        description: "[bar:hours]",
        start: { dateTime: "2026-08-10T10:00:00+02:00" },
        end: { dateTime: "2026-08-10T18:00:00+02:00" },
      },
    ]);

    expect(exceptions).toEqual([
      {
        _tag: "SpecialHours",
        date: "2026-08-10",
        opensAt: "10:00",
        closesAt: "18:00",
        closesNextDay: false,
        ongoing: false,
        sourceEventReference: "valid",
      },
    ]);
  });

  test("lets a closure win over special hours on the same date", async () => {
    const exceptions = await runWithEvents([
      {
        id: "hours",
        description: "[bar:hours]",
        start: { dateTime: "2026-08-06T10:00:00+02:00" },
        end: { dateTime: "2026-08-06T18:00:00+02:00" },
      },
      {
        id: "closed",
        description: "[bar:closed]",
        start: { date: "2026-08-06" },
        end: { date: "2026-08-07" },
      },
    ]);

    expect(exceptions).toEqual([
      {
        _tag: "Closed",
        date: "2026-08-06",
        sourceEventReference: "closed",
      },
    ]);
  });
});
