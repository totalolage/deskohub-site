import { auth, calendar, type calendar_v3 } from "@googleapis/calendar";
import { Context, Effect, Layer } from "effect";
import {
  GoogleCalendarRuntimeConfig,
  type GoogleCalendarRuntimeConfigObj,
  validateGoogleCalendarRuntimeConfig,
} from "../config";
import { GoogleCalendarAPIError, type GoogleCalendarError } from "../errors";
import type {
  GoogleCalendarEvent,
  GoogleCalendarEventDateTime,
  GoogleCalendarEventQuery,
} from "../types";

const calendarReadonlyScope =
  "https://www.googleapis.com/auth/calendar.readonly";
const defaultPageSize = 250;

export interface IGoogleCalendarService {
  readonly listEvents: (
    query: GoogleCalendarEventQuery
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

      const listEvents = Effect.fn("googleCalendar.listEvents")(
        function* (query: GoogleCalendarEventQuery) {
          yield* Effect.annotateLogsScoped({ query });
          yield* Effect.logInfo("Google Calendar events load started");

          const timeMin = toCalendarBoundary(addDays(query.from, -1));
          const timeMax = toCalendarBoundary(addDays(query.to, 2));
          const events: calendar_v3.Schema$Event[] = [];
          let pageToken: string | undefined;

          do {
            const response = yield* Effect.tryPromise({
              try: () =>
                client.events.list({
                  calendarId: config.calendarId,
                  maxResults: defaultPageSize,
                  orderBy: "startTime",
                  pageToken,
                  singleEvents: true,
                  timeMax,
                  timeMin,
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

            events.push(...(response.data.items ?? []));
            pageToken = response.data.nextPageToken ?? undefined;
          } while (pageToken);

          const result = events.map(toGoogleCalendarEvent);

          yield* Effect.annotateLogsScoped({ eventCount: result.length });
          yield* Effect.logInfo("Google Calendar events load completed");

          return result;
        },
        (effect, query) =>
          effect.pipe(
            Effect.scoped,
            Effect.annotateLogs({ from: query.from, to: query.to }),
            Effect.tapError((cause) =>
              Effect.logError("Google Calendar events load failed", {
                cause,
              })
            )
          )
      );

      return { listEvents };
    })
  );
}

const getCalendarClient = (config: GoogleCalendarRuntimeConfigObj) => {
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
  ...(event.status && { status: event.status }),
  ...(event.summary && { summary: event.summary }),
  ...(event.description && { description: event.description }),
  ...(event.start && { start: toGoogleCalendarEventDateTime(event.start) }),
  ...(event.end && { end: toGoogleCalendarEventDateTime(event.end) }),
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
