import { auth, calendar, type calendar_v3 } from "@googleapis/calendar";
import { Context, Effect, Layer, Option, Schema, Stream } from "effect";
import {
  GoogleCalendarRuntimeConfig,
  type IGoogleCalendarRuntimeConfig,
  validateGoogleCalendarRuntimeConfig,
} from "../config";
import { GoogleCalendarAPIError, type GoogleCalendarError } from "../errors";
import {
  GoogleCalendarChannelIdSchema,
  type GoogleCalendarEvent,
  type GoogleCalendarEventDateTime,
  GoogleCalendarEventIdSchema,
  GoogleCalendarICalUidSchema,
  type GoogleCalendarId,
  type GoogleCalendarListEventsInput,
  GoogleCalendarResourceIdSchema,
  type GoogleCalendarWatchChannel,
  type GoogleCalendarWatchEventsInput,
} from "../types";

const calendarReadonlyScope =
  "https://www.googleapis.com/auth/calendar.readonly";
const defaultPageSize = 250;

export interface IGoogleCalendarService {
  readonly listEvents: (
    input: GoogleCalendarListEventsInput
  ) => Effect.Effect<readonly GoogleCalendarEvent[], GoogleCalendarError>;
  readonly watchEvents: (
    input: GoogleCalendarWatchEventsInput
  ) => Effect.Effect<GoogleCalendarWatchChannel, GoogleCalendarError>;
}

export class GoogleCalendarService extends Context.Service<
  GoogleCalendarService,
  IGoogleCalendarService
>()("@deskohub/google-calendar/GoogleCalendarService") {
  static Default = Layer.effect(
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
            Effect.bind("result", ({ events }) =>
              Effect.all(events.map(toGoogleCalendarEvent), {
                concurrency: "inherit",
              })
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

      const watchEvents = Effect.fn("GoogleCalendarService.watchEvents")(
        (input: GoogleCalendarWatchEventsInput) =>
          Effect.tryPromise({
            try: () =>
              client.events
                .watch({
                  calendarId: input.calendarId,
                  requestBody: {
                    address: input.webhookUrl,
                    id: input.channelId,
                    params: { ttl: input.ttlSeconds.toString() },
                    token: input.webhookToken,
                    type: "web_hook",
                  },
                })
                .then(({ data }) => data),
            catch: (cause) =>
              new GoogleCalendarAPIError({
                operation: "events.watch",
                statusCode: getGoogleStatusCode(cause),
                message: getGoogleErrorMessage(cause),
                cause,
              }),
          }).pipe(
            Effect.flatMap((data) => toGoogleCalendarWatchChannel(data, input))
          ),
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({
              calendarId: input.calendarId,
              channelId: input.channelId,
              ttlSeconds: input.ttlSeconds,
              webhookUrl: input.webhookUrl,
            }),
            Effect.tapError((cause) =>
              Effect.logError("Google Calendar events watch failed", { cause })
            )
          )
      );

      const loadEventPages = (input: {
        readonly calendarId: GoogleCalendarId;
        readonly timeMax: string;
        readonly timeMin: string;
      }) =>
        Stream.paginate<
          string | undefined,
          calendar_v3.Schema$Event,
          GoogleCalendarAPIError
        >(undefined, (pageToken: string | undefined) =>
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
        readonly calendarId: GoogleCalendarId;
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

      return { listEvents, watchEvents };
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

const decodeGoogleIdentifier = <A>(
  schema: Schema.Decoder<A>,
  value: unknown,
  operation: string
) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      (cause) =>
        new GoogleCalendarAPIError({
          operation,
          message: "Google Calendar returned a malformed identifier.",
          cause,
        })
    )
  );

const decodeOptionalGoogleIdentifier = <A>(
  schema: Schema.Decoder<A>,
  value: unknown | null | undefined,
  operation: string
): Effect.Effect<Option.Option<A>, GoogleCalendarAPIError> =>
  value === null || value === undefined
    ? Effect.succeed(Option.none<A>())
    : decodeGoogleIdentifier(schema, value, operation).pipe(
        Effect.map(Option.some)
      );

const toGoogleCalendarEvent = (event: calendar_v3.Schema$Event) =>
  Effect.gen(function* () {
    const id = yield* decodeOptionalGoogleIdentifier(
      GoogleCalendarEventIdSchema,
      event.id,
      "events.list"
    );
    const iCalUID = yield* decodeOptionalGoogleIdentifier(
      GoogleCalendarICalUidSchema,
      event.iCalUID,
      "events.list"
    );
    const recurringEventId = yield* decodeOptionalGoogleIdentifier(
      GoogleCalendarEventIdSchema,
      event.recurringEventId,
      "events.list"
    );

    const result: GoogleCalendarEvent = {
      ...(Option.isSome(id) && { id: id.value }),
      ...(Option.isSome(iCalUID) && { iCalUID: iCalUID.value }),
      ...(event.htmlLink && { htmlLink: event.htmlLink }),
      ...(Option.isSome(recurringEventId) && {
        recurringEventId: recurringEventId.value,
      }),
      ...(event.status && { status: event.status }),
      ...(event.summary && { summary: event.summary }),
      ...(event.description && { description: event.description }),
      ...(event.start && { start: toGoogleCalendarEventDateTime(event.start) }),
      ...(event.end && { end: toGoogleCalendarEventDateTime(event.end) }),
      ...(event.originalStartTime && {
        originalStartTime: toGoogleCalendarEventDateTime(
          event.originalStartTime
        ),
      }),
    };

    return result;
  });

const toGoogleCalendarEventDateTime = (
  input: calendar_v3.Schema$EventDateTime
): GoogleCalendarEventDateTime => ({
  ...(input.date && { date: input.date }),
  ...(input.dateTime && { dateTime: input.dateTime }),
  ...(input.timeZone && { timeZone: input.timeZone }),
});

const toGoogleCalendarWatchChannel = (
  channel: calendar_v3.Schema$Channel,
  input: GoogleCalendarWatchEventsInput
) =>
  Effect.gen(function* () {
    const returnedChannelId = yield* decodeOptionalGoogleIdentifier(
      GoogleCalendarChannelIdSchema,
      channel.id,
      "events.watch"
    );
    const resourceId = yield* decodeOptionalGoogleIdentifier(
      GoogleCalendarResourceIdSchema,
      channel.resourceId,
      "events.watch"
    );

    const result: GoogleCalendarWatchChannel = {
      channelId: Option.getOrElse(returnedChannelId, () => input.channelId),
      ...(Option.isSome(resourceId) && { resourceId: resourceId.value }),
      ...(channel.resourceUri && { resourceUri: channel.resourceUri }),
      ...(channel.expiration && { expiration: Number(channel.expiration) }),
    };

    return result;
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
