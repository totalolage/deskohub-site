import {
  type GoogleCalendarError,
  type GoogleCalendarEvent,
  type GoogleCalendarEventQuery,
  GoogleCalendarService,
} from "@deskohub/google-calendar";
import { Context, Data, Effect, Layer } from "effect";

const fullMarker = "[workspace:full]";
const partialMarker = "[workspace:partial]";
const workspaceTimeZone = "Europe/Prague";

export type WorkspaceCalendarLimitation = Data.TaggedEnum<{
  FullyOccupied: {
    readonly date: string;
    readonly sourceEventId: string;
    readonly summary?: string;
  };
  PartiallyOccupied: {
    readonly date: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly sourceEventId: string;
    readonly summary?: string;
  };
}>;

export const WorkspaceCalendarLimitation =
  Data.taggedEnum<WorkspaceCalendarLimitation>();

export interface IGoogleCalendarWorkspaceLimitationsService {
  readonly listLimitations: (
    query: GoogleCalendarEventQuery
  ) => Effect.Effect<
    readonly WorkspaceCalendarLimitation[],
    GoogleCalendarError
  >;
}

export class GoogleCalendarWorkspaceLimitationsService extends Context.Service<
  GoogleCalendarWorkspaceLimitationsService,
  IGoogleCalendarWorkspaceLimitationsService
>()(
  "@deskohub-workspace/reservation/GoogleCalendarWorkspaceLimitationsService"
) {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const calendar = yield* GoogleCalendarService;

      const listLimitations = Effect.fn(
        "googleCalendarWorkspaceLimitations.listLimitations"
      )(
        function* (query: GoogleCalendarEventQuery) {
          yield* Effect.annotateLogsScoped({ query });
          yield* Effect.logInfo(
            "Google Calendar workspace limitations load started"
          );

          const events = yield* calendar.listEvents(query);
          const limitations = events
            .flatMap((event) => toWorkspaceCalendarLimitations(event))
            .filter((limitation) => isLimitationInRange(limitation, query));

          yield* Effect.annotateLogsScoped({
            limitationCount: limitations.length,
          });
          yield* Effect.logInfo(
            "Google Calendar workspace limitations load completed"
          );

          return limitations;
        },
        (effect, query) =>
          effect.pipe(
            Effect.scoped,
            Effect.annotateLogs({ from: query.from, to: query.to }),
            Effect.tapError((cause) =>
              Effect.logError(
                "Google Calendar workspace limitations load failed",
                { cause }
              )
            )
          )
      );

      return { listLimitations };
    })
  );
}

const toWorkspaceCalendarLimitations = (
  event: GoogleCalendarEvent
): readonly WorkspaceCalendarLimitation[] => {
  if (event.status === "cancelled") {
    return [];
  }

  const summary = event.summary?.trim();
  const normalizedDescription =
    event.description?.trim().toLocaleLowerCase("en-US") ?? "";
  const sourceEventId = event.id ?? event.iCalUID;

  if (!sourceEventId) {
    return [];
  }

  if (normalizedDescription.includes(fullMarker)) {
    return getEventDates(event).map((date) =>
      WorkspaceCalendarLimitation.FullyOccupied({
        date,
        sourceEventId,
        ...(summary && { summary }),
      })
    );
  }

  if (!normalizedDescription.includes(partialMarker)) {
    return [];
  }

  const date = getEventStartDate(event);
  const startsAt = getEventStartTime(event);
  const endsAt = getEventEndTime(event);

  if (!date || !startsAt || !endsAt) {
    return [];
  }

  return [
    WorkspaceCalendarLimitation.PartiallyOccupied({
      date,
      startsAt,
      endsAt,
      sourceEventId,
      ...(summary && { summary }),
    }),
  ];
};

const getEventDates = (event: GoogleCalendarEvent) => {
  const allDayStart = event.start?.date;
  const allDayEnd = event.end?.date;

  if (allDayStart && allDayEnd) {
    return getDateRange(allDayStart, addDays(allDayEnd, -1));
  }

  const start = getEventStartDate(event);
  const end = getEventEndDate(event) ?? start;

  if (!start || !end) {
    return [];
  }

  return getDateRange(start, getExclusiveMidnightEndDate(event) ?? end);
};

const getEventStartDate = (event: GoogleCalendarEvent) =>
  event.start?.date ?? getDateFromDateTime(event.start?.dateTime);

const getEventEndDate = (event: GoogleCalendarEvent) =>
  event.end?.date ?? getDateFromDateTime(event.end?.dateTime);

const getEventStartTime = (event: GoogleCalendarEvent) =>
  getTimeFromDateTime(event.start?.dateTime);

const getEventEndTime = (event: GoogleCalendarEvent) =>
  getTimeFromDateTime(event.end?.dateTime);

const getDateFromDateTime = (dateTime?: string) => dateTime?.slice(0, 10);

const getTimeFromDateTime = (dateTime?: string) => dateTime?.slice(11, 16);

const getExclusiveMidnightEndDate = (event: GoogleCalendarEvent) => {
  const endDateTime = event.end?.dateTime;
  if (!endDateTime) {
    return undefined;
  }

  const end = toWorkspaceZonedDateTime(endDateTime, event.end?.timeZone);

  if (!isMidnight(end)) {
    return undefined;
  }

  return end.toPlainDate().subtract({ days: 1 }).toString();
};

const toWorkspaceZonedDateTime = (dateTime: string, timeZone?: string) => {
  try {
    return Temporal.Instant.from(dateTime).toZonedDateTimeISO(
      workspaceTimeZone
    );
  } catch {
    return Temporal.PlainDateTime.from(dateTime)
      .toZonedDateTime(timeZone ?? workspaceTimeZone)
      .withTimeZone(workspaceTimeZone);
  }
};

const isMidnight = (dateTime: ReturnType<typeof toWorkspaceZonedDateTime>) =>
  dateTime.hour === 0 &&
  dateTime.minute === 0 &&
  dateTime.second === 0 &&
  dateTime.millisecond === 0 &&
  dateTime.microsecond === 0 &&
  dateTime.nanosecond === 0;

const getDateRange = (from: string, to: string) => {
  const dates: string[] = [];
  let cursor = from;

  while (cursor <= to) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return dates;
};

const addDays = (date: string, days: number) => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const isLimitationInRange = (
  limitation: WorkspaceCalendarLimitation,
  query: GoogleCalendarEventQuery
) => limitation.date >= query.from && limitation.date <= query.to;
