import {
  type ProviderRequestPolicy,
  ProviderRetryPolicy,
} from "@deskohub/provider-request";
import { auth, calendar, type calendar_v3 } from "@googleapis/calendar";
import {
  Context,
  type Duration,
  Effect,
  Layer,
  Option,
  Predicate,
  Schema,
  Stream,
} from "effect";
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
  type GoogleCalendarEventId,
  GoogleCalendarEventIdSchema,
  type GoogleCalendarICalUid,
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
const defaultRequestTimeout = "10 seconds";

/**
 * Event reads retry a transient failure once, after a jittered 100 ms
 * backoff. A watch registration runs once.
 */
const googleCalendarRetryPolicy = ProviderRetryPolicy.make({
  label: "Google Calendar",
  baseDelay: "100 millis",
  maxRetries: 1,
});

/**
 * A timeout, a network failure (no HTTP status), rate limiting, or a server
 * error is transient. Other client errors would fail again.
 */
const retryTransientGoogleCalendarError = googleCalendarRetryPolicy.retryWhile(
  (error: GoogleCalendarAPIError) =>
    error.statusCode === undefined ||
    error.statusCode === 429 ||
    error.statusCode >= 500
);

/**
 * `listEvents` retries each page request on its own and reads as many pages
 * as Google returns. It enforces one retried request's worst case over all of
 * its pages, so a load of any page count shares that budget.
 */
const getListEventsDeadline = (requestPolicy: ProviderRequestPolicy) =>
  requestPolicy.worstCase.retried;

/**
 * The longest one `listEvents` load can take: its whole-load deadline, the
 * budget of one retried request (the first attempt and its retry, each up to
 * `requestTimeout`, with the jittered backoff between them).
 */
export const getGoogleCalendarRequestWorstCaseDuration = (
  requestTimeout: Duration.Input
) => {
  const requestPolicy =
    googleCalendarRetryPolicy.withAttemptTimeout(requestTimeout);
  return requestPolicy.worstCase.paginated({
    pages: "unknown",
    retry: "each-page",
    deadline: getListEventsDeadline(requestPolicy),
  });
};

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
      const requestPolicy = googleCalendarRetryPolicy.withAttemptTimeout(
        config.requestTimeout ?? defaultRequestTimeout
      );

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
            Effect.bind("events", (range) =>
              loadEventPages(range).pipe(
                withinDeadline(
                  "events.list",
                  getListEventsDeadline(requestPolicy)
                )
              )
            ),
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
            try: (signal) =>
              client.events
                .watch(
                  {
                    calendarId: input.calendarId,
                    requestBody: {
                      address: input.webhookUrl,
                      id: input.channelId,
                      params: { ttl: input.ttlSeconds.toString() },
                      token: input.webhookToken,
                      type: "web_hook",
                    },
                  },
                  { signal }
                )
                .then(({ data }) => data),
            catch: (cause) =>
              new GoogleCalendarAPIError({
                operation: "events.watch",
                statusCode: getGoogleStatusCode(cause),
                message: getGoogleErrorMessage(cause),
                cause: withoutRequestBody(cause),
              }),
          }).pipe(
            requestPolicy.attempt(() => googleCalendarTimeout("events.watch")),
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
          try: (signal) =>
            client.events.list(
              {
                calendarId: input.calendarId,
                maxResults: defaultPageSize,
                orderBy: "startTime",
                pageToken: input.pageToken,
                singleEvents: true,
                timeMax: input.timeMax,
                timeMin: input.timeMin,
                timeZone: config.timeZone,
              },
              { signal }
            ),
          catch: (cause) =>
            new GoogleCalendarAPIError({
              operation: "events.list",
              statusCode: getGoogleStatusCode(cause),
              message: getGoogleErrorMessage(cause),
              cause,
            }),
        }).pipe(
          requestPolicy.attempt(() => googleCalendarTimeout("events.list")),
          retryTransientGoogleCalendarError
        );

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
      ...toGoogleCalendarEventIdentity({
        id,
        iCalUID,
        htmlLink: event.htmlLink,
        recurringEventId,
      }),
      ...toGoogleCalendarEventDetails(event),
    };

    return result;
  });

/** The event's decoded identifiers and link, omitting the absent ones. */
const toGoogleCalendarEventIdentity = ({
  id,
  iCalUID,
  htmlLink,
  recurringEventId,
}: {
  readonly id: Option.Option<GoogleCalendarEventId>;
  readonly iCalUID: Option.Option<GoogleCalendarICalUid>;
  readonly htmlLink: calendar_v3.Schema$Event["htmlLink"];
  readonly recurringEventId: Option.Option<GoogleCalendarEventId>;
}) => ({
  ...(Option.isSome(id) && { id: id.value }),
  ...(Option.isSome(iCalUID) && { iCalUID: iCalUID.value }),
  ...(htmlLink && { htmlLink }),
  ...(Option.isSome(recurringEventId) && {
    recurringEventId: recurringEventId.value,
  }),
});

/** The event's status, text and times, omitting the absent ones. */
const toGoogleCalendarEventDetails = (event: calendar_v3.Schema$Event) => ({
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

const googleCalendarTimeout = (operation: string) =>
  new GoogleCalendarAPIError({
    operation,
    message: "Google Calendar request timed out.",
  });

/** Interrupting the request aborts it, so a stalled provider call is released. */
const withinDeadline =
  (operation: string, deadline: Duration.Input) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.timeoutOrElse({
        duration: deadline,
        orElse: () => Effect.fail(googleCalendarTimeout(operation)),
      })
    );

/**
 * Gaxios errors carry the request configuration, including the body. A watch
 * request body holds the channel token that authenticates Google
 * notifications, so the body is removed before the error can be logged.
 */
const withoutRequestBody = (cause: unknown) => {
  const response = Predicate.hasProperty(cause, "response")
    ? cause.response
    : undefined;

  for (const holder of [cause, response]) {
    if (
      Predicate.hasProperty(holder, "config") &&
      Predicate.isObject(holder.config)
    ) {
      Object.assign(holder, {
        config: { ...holder.config, data: undefined, body: undefined },
      });
    }
  }

  return cause;
};

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
