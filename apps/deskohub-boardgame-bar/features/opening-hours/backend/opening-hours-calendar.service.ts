import type {
  GoogleCalendarError,
  GoogleCalendarEvent,
  GoogleCalendarEventQuery,
} from "@deskohub/google-calendar";
import { GoogleCalendarService } from "@deskohub/google-calendar";
import { Temporal } from "@js-temporal/polyfill";
import { Context, Data, Effect, Layer } from "effect";
import { siteConstants } from "@/shared/utils/constants";
import { OpeningHoursCalendarConfig } from "./opening-hours-calendar.config";

const closedMarker = "[bar:closed]";
const specialHoursMarker = "[bar:hours]";

export type OpeningHoursException = Data.TaggedEnum<{
  Closed: {
    readonly date: string;
    readonly sourceEventReference: string;
  };
  SpecialHours: {
    readonly date: string;
    readonly opensAt: string;
    readonly closesAt: string;
    readonly closesNextDay: boolean;
    readonly ongoing: boolean;
    readonly sourceEventReference: string;
  };
}>;

export const OpeningHoursException = Data.taggedEnum<OpeningHoursException>();

export type OpeningHoursExceptionQuery = GoogleCalendarEventQuery & {
  readonly now: string;
};

export interface IOpeningHoursCalendarService {
  readonly listExceptions: (
    query: OpeningHoursExceptionQuery
  ) => Effect.Effect<readonly OpeningHoursException[], GoogleCalendarError>;
}

export class OpeningHoursCalendarService extends Context.Service<
  OpeningHoursCalendarService,
  IOpeningHoursCalendarService
>()("@deskohub-boardgame-bar/opening-hours/OpeningHoursCalendarService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const calendar = yield* GoogleCalendarService;
      const { calendarId } = yield* OpeningHoursCalendarConfig;

      const listExceptions = Effect.fn(
        "OpeningHoursCalendarService.listExceptions"
      )(
        function* (query: OpeningHoursExceptionQuery) {
          yield* Effect.logInfo(
            "Google Calendar opening-hours exceptions load started"
          );

          const events = yield* calendar.listEvents({
            calendarId,
            from: query.from,
            to: query.to,
          });
          const eventExceptions = yield* Effect.forEach(events, (event) =>
            normalizeEvent(event, query).pipe(
              Effect.catch((error) =>
                Effect.logWarning(
                  "Ignoring invalid Google Calendar opening-hours event",
                  {
                    reason: error.reason,
                    sourceEventReference: error.sourceEventReference,
                  }
                ).pipe(Effect.as([] as readonly OpeningHoursException[]))
              )
            )
          );
          const exceptions = resolveDateConflicts(eventExceptions.flat());

          yield* Effect.logInfo(
            "Google Calendar opening-hours exceptions load completed",
            { exceptionCount: exceptions.length }
          );

          return exceptions;
        },
        (effect, query) =>
          effect.pipe(
            Effect.annotateLogs({
              calendarId,
              from: query.from,
              to: query.to,
            }),
            Effect.tapError((cause) =>
              Effect.logError(
                "Google Calendar opening-hours exceptions load failed",
                { cause }
              )
            )
          )
      );

      return { listExceptions };
    })
  );
}

class InvalidOpeningHoursEvent extends Data.TaggedError(
  "InvalidOpeningHoursEvent"
)<{
  readonly reason: string;
  readonly sourceEventReference: string;
  readonly cause?: unknown;
}> {}

const normalizeEvent = Effect.fn("normalizeOpeningHoursCalendarEvent")(
  function* (event: GoogleCalendarEvent, query: OpeningHoursExceptionQuery) {
    if (event.status === "cancelled") {
      return [];
    }

    const description = event.description?.toLocaleLowerCase("en-US") ?? "";
    const isClosed = description.includes(closedMarker);
    const hasSpecialHours = description.includes(specialHoursMarker);

    if (!isClosed && !hasSpecialHours) {
      return [];
    }

    const sourceEventReference = event.id ?? event.iCalUID ?? "unknown";

    if (!event.id && !event.iCalUID) {
      return yield* invalidEvent(
        sourceEventReference,
        "missing stable event reference"
      );
    }

    if (isClosed && hasSpecialHours) {
      return yield* invalidEvent(
        sourceEventReference,
        "event contains both opening-hours markers"
      );
    }

    return yield* isClosed
      ? normalizeClosedEvent(event, sourceEventReference, query)
      : normalizeSpecialHoursEvent(event, sourceEventReference, query);
  }
);

const normalizeClosedEvent = Effect.fn("normalizeClosedOpeningHoursEvent")(
  function* (
    event: GoogleCalendarEvent,
    sourceEventReference: string,
    query: OpeningHoursExceptionQuery
  ) {
    const start = event.start?.date;
    const end = event.end?.date;

    if (!start || !end || event.start?.dateTime || event.end?.dateTime) {
      return yield* invalidEvent(
        sourceEventReference,
        "closed marker requires an all-day event"
      );
    }

    const dates = yield* Effect.try({
      try: () => getDateRange(start, end),
      catch: (cause) =>
        new InvalidOpeningHoursEvent({
          sourceEventReference,
          reason: "all-day event has an invalid date range",
          cause,
        }),
    });

    if (dates.length === 0) {
      return yield* invalidEvent(
        sourceEventReference,
        "all-day event must end after it starts"
      );
    }

    return dates
      .filter((date) => date >= query.from && date <= query.to)
      .map((date) =>
        OpeningHoursException.Closed({ date, sourceEventReference })
      );
  }
);

const normalizeSpecialHoursEvent = Effect.fn(
  "normalizeSpecialOpeningHoursEvent"
)(function* (
  event: GoogleCalendarEvent,
  sourceEventReference: string,
  query: OpeningHoursExceptionQuery
) {
  const startValue = event.start?.dateTime;
  const endValue = event.end?.dateTime;

  if (!startValue || !endValue || event.start?.date || event.end?.date) {
    return yield* invalidEvent(
      sourceEventReference,
      "special-hours marker requires a timed event"
    );
  }

  const { start, end, now } = yield* Effect.try({
    try: () => ({
      start: toBarZonedDateTime(startValue, event.start?.timeZone),
      end: toBarZonedDateTime(endValue, event.end?.timeZone),
      now: Temporal.Instant.from(query.now),
    }),
    catch: (cause) =>
      new InvalidOpeningHoursEvent({
        sourceEventReference,
        reason: "timed event has an invalid date or time",
        cause,
      }),
  });

  if (Temporal.ZonedDateTime.compare(end, start) <= 0) {
    return yield* invalidEvent(
      sourceEventReference,
      "timed event must end after it starts"
    );
  }

  const startDate = start.toPlainDate();
  const endDate = end.toPlainDate();
  const localDaySpan = startDate.until(endDate).days;

  if (localDaySpan < 0 || localDaySpan > 1) {
    return yield* invalidEvent(
      sourceEventReference,
      "special opening hours may end only on the same or following day"
    );
  }

  const startInstant = start.toInstant();
  const endInstant = end.toInstant();
  const ongoing =
    Temporal.Instant.compare(startInstant, now) <= 0 &&
    Temporal.Instant.compare(endInstant, now) > 0;
  const date = startDate.toString();

  if (
    Temporal.Instant.compare(endInstant, now) <= 0 ||
    date > query.to ||
    (date < query.from && !ongoing)
  ) {
    return [];
  }

  const opensAt = toTime(start);
  const closesAt = toTime(end);
  const closesNextDay = localDaySpan === 1;

  if (!closesNextDay && matchesRegularHours(date, opensAt, closesAt)) {
    return [];
  }

  return [
    OpeningHoursException.SpecialHours({
      date,
      opensAt,
      closesAt,
      closesNextDay,
      ongoing,
      sourceEventReference,
    }),
  ];
});

const invalidEvent = (sourceEventReference: string, reason: string) =>
  Effect.fail(new InvalidOpeningHoursEvent({ sourceEventReference, reason }));

const toBarZonedDateTime = (dateTime: string, timeZone?: string) =>
  hasExplicitOffset(dateTime)
    ? Temporal.Instant.from(dateTime).toZonedDateTimeISO(
        siteConstants.workingHours.timezone
      )
    : Temporal.PlainDateTime.from(dateTime)
        .toZonedDateTime(timeZone ?? siteConstants.workingHours.timezone)
        .withTimeZone(siteConstants.workingHours.timezone);

const hasExplicitOffset = (dateTime: string) =>
  /(?:Z|[+-]\d{2}:\d{2})$/u.test(dateTime);

const getDateRange = (start: string, exclusiveEnd: string) => {
  const dates: string[] = [];
  let cursor = Temporal.PlainDate.from(start);
  const end = Temporal.PlainDate.from(exclusiveEnd);

  while (Temporal.PlainDate.compare(cursor, end) < 0) {
    dates.push(cursor.toString());
    cursor = cursor.add({ days: 1 });
  }

  return dates;
};

const toTime = (dateTime: Temporal.ZonedDateTime) =>
  `${dateTime.hour.toString().padStart(2, "0")}:${dateTime.minute
    .toString()
    .padStart(2, "0")}`;

const matchesRegularHours = (
  date: string,
  opensAt: string,
  closesAt: string
) => {
  const plainDate = Temporal.PlainDate.from(date);
  const dayIndex = (plainDate.dayOfWeek % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const regularHours = siteConstants.workingHours.hours[dayIndex];

  return (
    opensAt === toConfiguredTime(regularHours.open) &&
    closesAt === toConfiguredTime(regularHours.close)
  );
};

const toConfiguredTime = (time: {
  readonly hrs: number;
  readonly mins: number;
}) =>
  `${time.hrs.toString().padStart(2, "0")}:${time.mins
    .toString()
    .padStart(2, "0")}`;

const resolveDateConflicts = (exceptions: readonly OpeningHoursException[]) => {
  const closedDates = new Set(
    exceptions.flatMap((exception) =>
      exception._tag === "Closed" ? [exception.date] : []
    )
  );
  const unique = new Map<string, OpeningHoursException>();

  for (const exception of exceptions) {
    if (exception._tag === "SpecialHours" && closedDates.has(exception.date)) {
      continue;
    }

    const key =
      exception._tag === "Closed"
        ? `closed:${exception.date}`
        : `hours:${exception.date}:${exception.opensAt}:${exception.closesAt}`;
    unique.set(key, exception);
  }

  return [...unique.values()].sort(compareExceptions);
};

const compareExceptions = (
  left: OpeningHoursException,
  right: OpeningHoursException
) =>
  left.date.localeCompare(right.date) ||
  (left._tag === "Closed" ? "" : left.opensAt).localeCompare(
    right._tag === "Closed" ? "" : right.opensAt
  );
