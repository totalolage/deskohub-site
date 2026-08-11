import { describe, expect, mock, test } from "bun:test";
import {
  GoogleCalendarChannelIdSchema,
  type GoogleCalendarEvent,
  GoogleCalendarEventIdSchema,
  GoogleCalendarIdSchema,
  type GoogleCalendarListEventsInput,
  type GoogleCalendarWatchEventsInput,
} from "@deskohub/google-calendar";
import { GoogleCalendarServiceMock } from "@deskohub/google-calendar/backend/service.mock";
import { Effect, Layer, Schema } from "effect";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";

setBoardgameTestEnv();

type OpeningHoursExceptionQuery = {
  readonly from: Temporal.PlainDate;
  readonly to: Temporal.PlainDate;
};

const defaultQuery = {
  from: Temporal.PlainDate.from("2026-08-02"),
  to: Temporal.PlainDate.from("2026-08-10"),
} satisfies OpeningHoursExceptionQuery;

const plainDate = Temporal.PlainDate.from;
const plainTime = Temporal.PlainTime.from;
const eventId = Schema.decodeUnknownSync(GoogleCalendarEventIdSchema);
const openingHoursCalendarId = Schema.decodeUnknownSync(GoogleCalendarIdSchema)(
  "opening-hours-calendar"
);
const openingHoursChannelId = Schema.decodeUnknownSync(
  GoogleCalendarChannelIdSchema
)("channel-id");

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
              calendarId: openingHoursCalendarId,
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
        channelId: openingHoursChannelId,
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
                calendarId: openingHoursCalendarId,
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(watchInputs).toEqual([
      {
        calendarId: openingHoursCalendarId,
        channelId: openingHoursChannelId,
        webhookUrl: "https://bar.example.test/webhook",
        webhookToken: "derived-token",
        ttlSeconds: 259_200,
      },
    ]);
    expect(channel).toEqual({ channelId: openingHoursChannelId });
  });

  test("loads the configured resource and translates marked events", async () => {
    const inputs: GoogleCalendarListEventsInput[] = [];
    const exceptions = await runWithEvents(
      [
        {
          id: eventId("planning-only"),
          summary: "Private event planning",
          start: { date: "2026-08-03" },
          end: { date: "2026-08-04" },
        },
        {
          id: eventId("cancelled"),
          status: "cancelled",
          description: "[bar:closed]",
          start: { date: "2026-08-03" },
          end: { date: "2026-08-04" },
        },
        {
          id: eventId("closed"),
          description: "Holiday [bar:closed]",
          start: { date: "2026-08-04" },
          end: { date: "2026-08-06" },
        },
        {
          id: eventId("special-hours"),
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
        calendarId: openingHoursCalendarId,
        from: defaultQuery.from.toString(),
        to: defaultQuery.to.toString(),
      },
    ]);
    expect(exceptions).toEqual([
      {
        _tag: "Closed",
        date: plainDate("2026-08-04"),
        sourceEventReference: "closed",
      },
      {
        _tag: "Closed",
        date: plainDate("2026-08-05"),
        sourceEventReference: "closed",
      },
      {
        _tag: "SpecialHours",
        date: plainDate("2026-08-07"),
        opensAt: plainTime("12:00"),
        closesAt: plainTime("20:30"),
        closesNextDay: false,
        sourceEventReference: "special-hours",
      },
    ]);
  });

  test("uses Prague-local dates and supports cross-midnight opening hours", async () => {
    const exceptions = await runWithEvents([
      {
        id: eventId("offset-crosses-date"),
        description: "[bar:hours]",
        start: { dateTime: "2026-08-02T22:30:00Z" },
        end: { dateTime: "2026-08-03T03:00:00Z" },
      },
      {
        id: eventId("floating-time"),
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
        date: plainDate("2026-08-03"),
        opensAt: plainTime("00:30"),
        closesAt: plainTime("05:00"),
        closesNextDay: false,
        sourceEventReference: "offset-crosses-date",
      },
      {
        _tag: "SpecialHours",
        date: plainDate("2026-08-08"),
        opensAt: plainTime("20:00"),
        closesAt: plainTime("02:00"),
        closesNextDay: true,
        sourceEventReference: "floating-time",
      },
    ]);
  });

  test("uses Prague-local clock times across daylight-saving changes", async () => {
    const exceptions = await runWithEvents(
      [
        {
          id: eventId("dst-transition"),
          description: "[bar:hours]",
          start: { dateTime: "2026-03-29T00:30:00Z" },
          end: { dateTime: "2026-03-29T02:30:00Z" },
        },
      ],
      {
        from: plainDate("2026-03-29"),
        to: plainDate("2026-03-29"),
      }
    );

    expect(exceptions).toEqual([
      {
        _tag: "SpecialHours",
        date: plainDate("2026-03-29"),
        opensAt: plainTime("01:30"),
        closesAt: plainTime("04:30"),
        closesNextDay: false,
        sourceEventReference: "dst-transition",
      },
    ]);
  });

  test("keeps exceptions inside the local start-date window", async () => {
    const query = {
      from: plainDate("2026-08-09"),
      to: plainDate("2026-08-10"),
    } satisfies OpeningHoursExceptionQuery;
    const exceptions = await runWithEvents(
      [
        {
          id: eventId("before-window"),
          description: "[bar:hours]",
          start: { dateTime: "2026-08-08T20:00:00+02:00" },
          end: { dateTime: "2026-08-09T02:00:00+02:00" },
        },
        {
          id: eventId("inside-window"),
          description: "[bar:hours]",
          start: { dateTime: "2026-08-09T00:00:00+02:00" },
          end: { dateTime: "2026-08-09T00:15:00+02:00" },
        },
        {
          id: eventId("outside-padded-window"),
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
        date: plainDate("2026-08-09"),
        opensAt: plainTime("00:00"),
        closesAt: plainTime("00:15"),
        closesNextDay: false,
        sourceEventReference: "inside-window",
      },
    ]);
  });

  test("keeps same-day exceptions stable after their end time", async () => {
    const exceptions = await runWithEvents(
      [
        {
          id: eventId("same-day-ended"),
          description: "[bar:hours]",
          start: { dateTime: "2026-08-09T00:00:00+02:00" },
          end: { dateTime: "2026-08-09T00:15:00+02:00" },
        },
      ],
      {
        from: plainDate("2026-08-09"),
        to: plainDate("2026-08-10"),
      }
    );

    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]).toMatchObject({
      _tag: "SpecialHours",
      date: plainDate("2026-08-09"),
      opensAt: plainTime("00:00"),
      closesAt: plainTime("00:15"),
      closesNextDay: false,
      sourceEventReference: "same-day-ended",
    });
  });

  test("ignores no-op and malformed events without dropping valid events", async () => {
    const exceptions = await runWithEvents([
      {
        id: eventId("regular-monday-hours"),
        description: "[bar:hours]",
        start: { dateTime: "2026-08-03T17:00:00+02:00" },
        end: { dateTime: "2026-08-03T23:00:00+02:00" },
      },
      {
        id: eventId("conflicting-markers"),
        description: "[bar:closed] [bar:hours]",
        start: { date: "2026-08-04" },
        end: { date: "2026-08-05" },
      },
      {
        id: eventId("closed-but-timed"),
        description: "[bar:closed]",
        start: { dateTime: "2026-08-05T12:00:00+02:00" },
        end: { dateTime: "2026-08-05T13:00:00+02:00" },
      },
      {
        id: eventId("invalid-all-day-date"),
        description: "[bar:closed]",
        start: { date: "not-a-date" },
        end: { date: "2026-08-07" },
      },
      {
        id: eventId("invalid-timed-date"),
        description: "[bar:hours]",
        start: { dateTime: "not-a-date-time" },
        end: { dateTime: "2026-08-07T20:00:00+02:00" },
      },
      {
        description: "[bar:closed]",
        start: { date: "2026-08-06" },
        end: { date: "2026-08-07" },
      },
      {
        id: eventId("valid"),
        description: "[bar:hours]",
        start: { dateTime: "2026-08-10T10:00:00+02:00" },
        end: { dateTime: "2026-08-10T18:00:00+02:00" },
      },
    ]);

    expect(exceptions).toEqual([
      {
        _tag: "SpecialHours",
        date: plainDate("2026-08-10"),
        opensAt: plainTime("10:00"),
        closesAt: plainTime("18:00"),
        closesNextDay: false,
        sourceEventReference: "valid",
      },
    ]);
  });

  test("lets a closure win over special hours on the same date", async () => {
    const exceptions = await runWithEvents([
      {
        id: eventId("hours"),
        description: "[bar:hours]",
        start: { dateTime: "2026-08-06T10:00:00+02:00" },
        end: { dateTime: "2026-08-06T18:00:00+02:00" },
      },
      {
        id: eventId("closed"),
        description: "[bar:closed]",
        start: { date: "2026-08-06" },
        end: { date: "2026-08-07" },
      },
    ]);

    expect(exceptions).toEqual([
      {
        _tag: "Closed",
        date: plainDate("2026-08-06"),
        sourceEventReference: "closed",
      },
    ]);
  });
});
