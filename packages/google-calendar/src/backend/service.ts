import { auth, calendar, type calendar_v3 } from "@googleapis/calendar";
import { Context, Effect, Layer, Option, Stream } from "effect";
import {
  GoogleCalendarRuntimeConfig,
  type IGoogleCalendarRuntimeConfig,
  validateGoogleCalendarRuntimeConfig,
} from "../config";
import { GoogleCalendarAPIError, type GoogleCalendarError } from "../errors";
import type {
  GoogleCalendarEvent,
  GoogleCalendarEventDateTime,
  GoogleCalendarListEventsInput,
} from "../types";

const calendarReadonlyScope =
  "https://www.googleapis.com/auth/calendar.readonly";
const defaultPageSize = 250;

export interface IGoogleCalendarService {
  readonly listEvents: (
    input: GoogleCalendarListEventsInput
  ) => Effect.Effect<readonly GoogleCalendarEvent[], GoogleCalendarError>;
}

export class GoogleCalendarService extends Context.Service<
  GoogleCalendarService,
  IGoogleCalendarService
>()("@deskohub/google-calendar/GoogleCalendarService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const rawConfig = yield* GoogleCalendarRuntimeConfig;
      const config = yield* validateGoogleCalendarRuntimeConfig(rawConfig);
      const client = getCalendarClient(config);

      const listEvents = Effect.fn("GoogleCalendarService.listEvents")(
        (input: GoogleCalendarListEventsInput) =>
          Effect.succeed(input).pipe(
            Effect.tap(() =>
              Effect.logInfo("Google Calendar events load started")
            ),
            Effect.let("timeMin", ({ from }) =>
              toCalendarBoundary(addDays(from, -1))
            ),
            Effect.let("timeMax", ({ to }) =>
              toCalendarBoundary(addDays(to, 2))
            ),
            Effect.bind("events", loadEventPages),
            Effect.let("result", ({ events }) =>
              events.map(toGoogleCalendarEvent)
            ),
            Effect.tap(({ result }) =>
              Effect.annotateLogsScoped({ eventCount: result.length })
            ),
            Effect.tap(() =>
              Effect.logInfo("Google Calendar events load completed")
            ),
            Effect.map(({ result }) => result)
          ),
        (effect, input) =>
          effect.pipe(
            Effect.scoped,
            Effect.annotateLogs({
              calendarId: input.calendarId,
              from: input.from,
              to: input.to,
            }),
            Effect.tapError((cause) =>
              Effect.logError("Google Calendar events load failed", {
                cause,
              })
            )
          )
      );

      const loadEventPages = (input: {
        readonly calendarId: string;
        readonly timeMax: string;
        readonly timeMin: string;
      }) =>
        Stream.paginate(
          undefined as string | undefined,
          (pageToken: string | undefined) =>
            loadEventPage({ ...input, pageToken }).pipe(
              Effect.map(
                (response) =>
                  [
                    response.data.items ?? [],
                    Option.fromNullishOr(response.data.nextPageToken),
                  ] as const
              )
            )
        ).pipe(Stream.runCollect);

      const loadEventPage = (input: {
        readonly calendarId: string;
        readonly pageToken?: string;
        readonly timeMax: string;
        readonly timeMin: string;
      }) =>
        Effect.tryPromise({
          try: () =>
            client.events.list({
              calendarId: input.calendarId,
              maxResults: defaultPageSize,
              orderBy: "startTime",
              pageToken: input.pageToken,
              singleEvents: true,
              timeMax: input.timeMax,
              timeMin: input.timeMin,
              timeZone: config.timeZone,
            }),
          catch: (cause) =>
            new GoogleCalendarAPIError({
              operation: "events.list",
              statusCode: getGoogleStatusCode(cause),
              message: getGoogleErrorMessage(cause),
              cause,
            }),
        });

      return { listEvents };
    })
  );
}

const getCalendarClient = (config: IGoogleCalendarRuntimeConfig) => {
  const clientAuth = new auth.JWT({
    email: config.serviceAccountEmail,
    key: config.privateKey.replaceAll("\\n", "\n"),
    scopes: [calendarReadonlyScope],
  });

  return calendar({
    version: "v3",
    auth: clientAuth,
  });
};

const toGoogleCalendarEvent = (
  event: calendar_v3.Schema$Event
): GoogleCalendarEvent => ({
  ...(event.id && { id: event.id }),
  ...(event.iCalUID && { iCalUID: event.iCalUID }),
  ...(event.recurringEventId && { recurringEventId: event.recurringEventId }),
  ...(event.status && { status: event.status }),
  ...(event.summary && { summary: event.summary }),
  ...(event.description && { description: event.description }),
  ...(event.start && { start: toGoogleCalendarEventDateTime(event.start) }),
  ...(event.end && { end: toGoogleCalendarEventDateTime(event.end) }),
  ...(event.originalStartTime && {
    originalStartTime: toGoogleCalendarEventDateTime(event.originalStartTime),
  }),
});

const toGoogleCalendarEventDateTime = (
  input: calendar_v3.Schema$EventDateTime
): GoogleCalendarEventDateTime => ({
  ...(input.date && { date: input.date }),
  ...(input.dateTime && { dateTime: input.dateTime }),
  ...(input.timeZone && { timeZone: input.timeZone }),
});

const addDays = (date: string, days: number) => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const toCalendarBoundary = (date: string) => `${date}T00:00:00Z`;

const getGoogleStatusCode = (cause: unknown) => {
  if (!cause || typeof cause !== "object") {
    return undefined;
  }

  const status = Object.getOwnPropertyDescriptor(cause, "status")?.value;
  return typeof status === "number" ? status : undefined;
};

const getGoogleErrorMessage = (cause: unknown) => {
  if (!cause || typeof cause !== "object") {
    return undefined;
  }

  const message = Object.getOwnPropertyDescriptor(cause, "message")?.value;
  return typeof message === "string" ? message : undefined;
};
