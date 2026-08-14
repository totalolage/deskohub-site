import type {
  GoogleCalendarError,
  GoogleCalendarEvent,
  GoogleCalendarWatchChannel,
  GoogleCalendarWatchEventsInput,
} from "@deskohub/google-calendar";
import { GoogleCalendarService } from "@deskohub/google-calendar";
import { Context, Data, Effect, Layer, Match, Option } from "effect";
import { BoardgameGoogleCalendarLayer } from "@/shared/backend/config/google-calendar.config";
import { siteConstants } from "@/shared/utils/constants";
import { OpeningHoursCalendarConfig } from "./opening-hours-calendar.config";

const closedMarker = "[bar:closed]";
const specialHoursMarker = "[bar:hours]";

export type OpeningHoursException = Data.TaggedEnum<{
  Closed: {
    readonly date: Temporal.PlainDate;
    readonly sourceEventReference: string;
  };
  SpecialHours: {
    readonly date: Temporal.PlainDate;
    readonly opensAt: Temporal.PlainTime;
    readonly closesAt: Temporal.PlainTime;
    readonly closesNextDay: boolean;
    readonly sourceEventReference: string;
  };
}>;

export const OpeningHoursException = Data.taggedEnum<OpeningHoursException>();

export interface OpeningHoursExceptionQuery {
  readonly from: Temporal.PlainDate;
  readonly to: Temporal.PlainDate;
}

export type OpeningHoursCalendarWatchInput = Omit<
  GoogleCalendarWatchEventsInput,
  "calendarId"
>;

export interface IOpeningHoursCalendarService {
  readonly listExceptions: (
    query: OpeningHoursExceptionQuery
  ) => Effect.Effect<readonly OpeningHoursException[], GoogleCalendarError>;
  readonly watchChanges: (
    input: OpeningHoursCalendarWatchInput
  ) => Effect.Effect<GoogleCalendarWatchChannel, GoogleCalendarError>;
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
            from: query.from.toString(),
            to: query.to.toString(),
          });
          const exceptions = resolveDateConflicts(
            events.flatMap((event) => getEventExceptions(event, query))
          );

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
              from: query.from.toString(),
              to: query.to.toString(),
            }),
            Effect.tapError((cause) =>
              Effect.logError(
                "Google Calendar opening-hours exceptions load failed",
                { cause }
              )
            )
          )
      );

      const watchChanges = Effect.fn(
        "OpeningHoursCalendarService.watchChanges"
      )((input: OpeningHoursCalendarWatchInput) =>
        calendar.watchEvents({ ...input, calendarId })
      );

      return { listExceptions, watchChanges };
    })
  );

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(BoardgameGoogleCalendarLayer),
    Layer.provide(OpeningHoursCalendarConfig.Live)
  );
}

export const getOpeningHoursExceptionKey = (exception: OpeningHoursException) =>
  Match.value(exception).pipe(
    Match.tagsExhaustive({
      Closed: ({ date }) => `closed:${date}`,
      SpecialHours: ({ closesAt, date, opensAt }) =>
        `hours:${date}:${opensAt}:${closesAt}`,
    })
  );

const getEventExceptions = (
  event: GoogleCalendarEvent,
  query: OpeningHoursExceptionQuery
): readonly OpeningHoursException[] => {
  if (event.status === "cancelled") {
    return [];
  }

  const description = event.description?.toLocaleLowerCase("en-US") ?? "";
  const isClosed = description.includes(closedMarker);
  const hasSpecialHours = description.includes(specialHoursMarker);
  const sourceEventReference = event.id ?? event.iCalUID;

  if (!sourceEventReference || isClosed === hasSpecialHours) {
    return [];
  }

  return isClosed
    ? getClosedExceptions(event, sourceEventReference, query)
    : getSpecialHoursExceptions(event, sourceEventReference, query);
};

const getClosedExceptions = (
  event: GoogleCalendarEvent,
  sourceEventReference: string,
  query: OpeningHoursExceptionQuery
): readonly OpeningHoursException[] => {
  const start = event.start?.date;
  const end = event.end?.date;

  if (!start || !end || event.start?.dateTime || event.end?.dateTime) {
    return [];
  }

  return getDateRange({ start, exclusiveEnd: end }).pipe(
    Option.map((dates) =>
      dates
        .filter((date) => isDateInRange(date, query))
        .map((date) =>
          OpeningHoursException.Closed({ date, sourceEventReference })
        )
    ),
    Option.getOrElse(() => [])
  );
};

const getSpecialHoursExceptions = (
  event: GoogleCalendarEvent,
  sourceEventReference: string,
  query: OpeningHoursExceptionQuery
): readonly OpeningHoursException[] => {
  const startValue = event.start?.dateTime;
  const endValue = event.end?.dateTime;

  if (!startValue || !endValue || event.start?.date || event.end?.date) {
    return [];
  }

  return Option.all({
    start: toBarZonedDateTime(startValue, event.start?.timeZone),
    end: toBarZonedDateTime(endValue, event.end?.timeZone),
  }).pipe(
    Option.map(({ end, start }) =>
      toSpecialHoursException({
        end,
        query,
        sourceEventReference,
        start,
      })
    ),
    Option.getOrElse(() => [])
  );
};

const toSpecialHoursException = (input: {
  readonly start: Temporal.ZonedDateTime;
  readonly end: Temporal.ZonedDateTime;
  readonly sourceEventReference: string;
  readonly query: OpeningHoursExceptionQuery;
}): readonly OpeningHoursException[] => {
  if (Temporal.ZonedDateTime.compare(input.end, input.start) <= 0) {
    return [];
  }

  const date = input.start.toPlainDate();
  const localDaySpan = date.until(input.end.toPlainDate()).days;
  if (
    localDaySpan < 0 ||
    localDaySpan > 1 ||
    !isDateInRange(date, input.query)
  ) {
    return [];
  }

  const opensAt = toMinuteTime(input.start);
  const closesAt = toMinuteTime(input.end);
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
      sourceEventReference: input.sourceEventReference,
    }),
  ];
};

const toBarZonedDateTime = Option.liftThrowable(
  (dateTime: string, timeZone: string | undefined) =>
    hasExplicitOffset(dateTime)
      ? Temporal.Instant.from(dateTime).toZonedDateTimeISO(
          siteConstants.workingHours.timezone
        )
      : Temporal.PlainDateTime.from(dateTime)
          .toZonedDateTime(timeZone ?? siteConstants.workingHours.timezone)
          .withTimeZone(siteConstants.workingHours.timezone)
);

const hasExplicitOffset = (dateTime: string) =>
  /(?:Z|[+-]\d{2}:\d{2})$/u.test(dateTime);

const getDateRange = Option.liftThrowable(
  (input: { readonly start: string; readonly exclusiveEnd: string }) => {
    const dates: Temporal.PlainDate[] = [];
    let cursor = Temporal.PlainDate.from(input.start);
    const end = Temporal.PlainDate.from(input.exclusiveEnd);

    while (Temporal.PlainDate.compare(cursor, end) < 0) {
      dates.push(cursor);
      cursor = cursor.add({ days: 1 });
    }

    return dates;
  }
);

const isDateInRange = (
  date: Temporal.PlainDate,
  query: OpeningHoursExceptionQuery
) =>
  Temporal.PlainDate.compare(date, query.from) >= 0 &&
  Temporal.PlainDate.compare(date, query.to) <= 0;

const toMinuteTime = (dateTime: Temporal.ZonedDateTime) =>
  Temporal.PlainTime.from({ hour: dateTime.hour, minute: dateTime.minute });

const matchesRegularHours = (
  date: Temporal.PlainDate,
  opensAt: Temporal.PlainTime,
  closesAt: Temporal.PlainTime
) => {
  const dayIndex = (date.dayOfWeek % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const regularHours = siteConstants.workingHours.hours[dayIndex];

  return (
    Temporal.PlainTime.compare(opensAt, toConfiguredTime(regularHours.open)) ===
      0 &&
    Temporal.PlainTime.compare(
      closesAt,
      toConfiguredTime(regularHours.close)
    ) === 0
  );
};

const toConfiguredTime = (time: {
  readonly hrs: number;
  readonly mins: number;
}) => Temporal.PlainTime.from({ hour: time.hrs, minute: time.mins });

const resolveDateConflicts = (exceptions: readonly OpeningHoursException[]) => {
  const closedDates = new Set(
    exceptions
      .filter(OpeningHoursException.$is("Closed"))
      .map(({ date }) => date.toString())
  );
  const unique = new Map<string, OpeningHoursException>();

  for (const exception of exceptions) {
    if (
      OpeningHoursException.$is("SpecialHours")(exception) &&
      closedDates.has(exception.date.toString())
    ) {
      continue;
    }

    unique.set(getOpeningHoursExceptionKey(exception), exception);
  }

  return [...unique.values()].sort(compareExceptions);
};

const compareExceptions = (
  left: OpeningHoursException,
  right: OpeningHoursException
) => {
  const dateOrder = Temporal.PlainDate.compare(left.date, right.date);
  if (dateOrder !== 0) {
    return dateOrder;
  }

  const leftTime = getExceptionStartTime(left);
  const rightTime = getExceptionStartTime(right);
  if (!leftTime) {
    return rightTime ? -1 : 0;
  }
  if (!rightTime) {
    return 1;
  }

  return Temporal.PlainTime.compare(leftTime, rightTime);
};

const getExceptionStartTime = (exception: OpeningHoursException) =>
  Match.value(exception).pipe(
    Match.tagsExhaustive({
      Closed: () => undefined,
      SpecialHours: ({ opensAt }) => opensAt,
    })
  );
