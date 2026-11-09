import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Duration, Effect, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  GoogleCalendarRuntimeConfig,
  type IGoogleCalendarRuntimeConfig,
} from "../config";
import {
  GoogleCalendarChannelIdSchema,
  GoogleCalendarEventIdSchema,
  GoogleCalendarICalUidSchema,
  GoogleCalendarIdSchema,
  GoogleCalendarResourceIdSchema,
} from "../types";

type CalendarListQuery = {
  readonly calendarId: string;
  readonly pageToken?: string;
  readonly [key: string]: unknown;
};

type CalendarListResponse = {
  readonly data: {
    readonly items: readonly unknown[];
    readonly nextPageToken?: string;
  };
};

type RequestOptions = { readonly signal?: AbortSignal };

type ListEventsImplementation = (
  params: CalendarListQuery,
  options?: RequestOptions
) => Promise<CalendarListResponse>;

type WatchEventsImplementation = (
  params: {
    readonly calendarId: string;
    readonly requestBody?: unknown;
  },
  options?: RequestOptions
) => Promise<{
  readonly data: {
    readonly id?: string | null;
    readonly resourceId?: string | null;
    readonly resourceUri?: string | null;
    readonly expiration?: string | null;
  };
}>;

let listEvents = mock<ListEventsImplementation>(async () => ({
  data: { items: [] },
}));
let watchEvents = mock<WatchEventsImplementation>(async () => ({ data: {} }));
const jwtCalls: unknown[] = [];

mock.module("@googleapis/calendar", () => ({
  auth: {
    JWT: class {
      constructor(options: unknown) {
        jwtCalls.push(options);
      }
    },
  },
  calendar: mock(() => ({
    events: { list: listEvents, watch: watchEvents },
  })),
}));

const { GoogleCalendarService, getGoogleCalendarRequestWorstCaseDuration } =
  await import("./service");

type GoogleCalendarRequirement = import("./service").GoogleCalendarService;

const serviceAccountEmail = testEmailAddress("service");

const config = {
  serviceAccountEmail,
  privateKey: "line1\\nline2",
  timeZone: "Europe/Prague",
};

const decodeCalendarId = Schema.decodeUnknownSync(GoogleCalendarIdSchema);
const decodeEventId = Schema.decodeUnknownSync(GoogleCalendarEventIdSchema);
const decodeICalUid = Schema.decodeUnknownSync(GoogleCalendarICalUidSchema);
const decodeChannelId = Schema.decodeUnknownSync(GoogleCalendarChannelIdSchema);
const decodeResourceId = Schema.decodeUnknownSync(
  GoogleCalendarResourceIdSchema
);

const calendarId = decodeCalendarId("calendar-id");
const workspaceLimitationsCalendarId = decodeCalendarId(
  "workspace-limitations-calendar"
);
const salesCalendarId = decodeCalendarId("sales-calendar");
const requestedChannelId = decodeChannelId("requested-channel-id");

beforeEach(() => {
  listEvents = mock<ListEventsImplementation>(async () => ({
    data: { items: [] },
  }));
  watchEvents = mock<WatchEventsImplementation>(async () => ({ data: {} }));
  jwtCalls.length = 0;
});

const runWithCalendar = <A, E>(
  effect: Effect.Effect<A, E, GoogleCalendarRequirement>,
  runtimeConfig: IGoogleCalendarRuntimeConfig = config
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        GoogleCalendarService.Default.pipe(
          Layer.provide(
            Layer.succeed(GoogleCalendarRuntimeConfig, runtimeConfig)
          )
        )
      )
    )
  );

/** A provider request that never answers until it is aborted. */
const stalledRequest = (
  options: RequestOptions | undefined,
  onAbort: () => void = () => undefined
) =>
  new Promise<CalendarListResponse>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => {
      onAbort();
      reject(new Error("aborted"));
    });
  });

const providerError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

/** Lists events while advancing the test clock by each of `steps` in turn. */
const listEventsAdvancingClock = (steps: readonly Duration.Input[]) =>
  Effect.gen(function* () {
    const googleCalendar = yield* GoogleCalendarService;
    const fiber = yield* googleCalendar
      .listEvents({ calendarId, from: "2026-06-20", to: "2026-06-21" })
      .pipe(Effect.result, Effect.forkChild);
    for (const step of steps) {
      yield* TestClock.adjust(step);
    }
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestClock.layer()));

describe("GoogleCalendarService", () => {
  test("paginates, expands date window, maps key newlines and events", async () => {
    listEvents = mock<ListEventsImplementation>(async (params) =>
      params.pageToken
        ? {
            data: {
              items: [
                {
                  id: "event-2",
                  start: { date: "2026-06-22" },
                  end: { date: "2026-06-23" },
                },
              ],
            },
          }
        : {
            data: {
              nextPageToken: "next-page",
              items: [
                {
                  id: "event-1",
                  htmlLink: "https://calendar.google.com/event?eid=event-1",
                  iCalUID: "ical-1",
                  recurringEventId: "recurring-event-1",
                  status: "confirmed",
                  summary: "Summary",
                  description: "Description",
                  start: {
                    dateTime: "2026-06-20T10:00:00+02:00",
                    timeZone: "Europe/Prague",
                  },
                  end: { dateTime: "2026-06-20T11:00:00+02:00" },
                  originalStartTime: {
                    dateTime: "2026-06-20T09:00:00+02:00",
                    timeZone: "Europe/Prague",
                  },
                },
              ],
            },
          }
    );

    const result = await runWithCalendar(
      Effect.gen(function* () {
        const googleCalendar = yield* GoogleCalendarService;
        return yield* googleCalendar.listEvents({
          calendarId,
          from: "2026-06-20",
          to: "2026-06-21",
        });
      })
    );

    expect(jwtCalls[0]).toMatchObject({
      email: serviceAccountEmail,
      key: "line1\nline2",
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    });
    expect(listEvents.mock.calls[0]?.[0]).toMatchObject({
      calendarId: "calendar-id",
      orderBy: "startTime",
      singleEvents: true,
      timeMin: "2026-06-19T00:00:00Z",
      timeMax: "2026-06-23T00:00:00Z",
      timeZone: "Europe/Prague",
    });
    expect(listEvents.mock.calls[1]?.[0]).toMatchObject({
      calendarId: "calendar-id",
      pageToken: "next-page",
    });
    expect(result).toEqual([
      {
        id: decodeEventId("event-1"),
        htmlLink: "https://calendar.google.com/event?eid=event-1",
        iCalUID: decodeICalUid("ical-1"),
        recurringEventId: decodeEventId("recurring-event-1"),
        status: "confirmed",
        summary: "Summary",
        description: "Description",
        start: {
          dateTime: "2026-06-20T10:00:00+02:00",
          timeZone: "Europe/Prague",
        },
        end: { dateTime: "2026-06-20T11:00:00+02:00" },
        originalStartTime: {
          dateTime: "2026-06-20T09:00:00+02:00",
          timeZone: "Europe/Prague",
        },
      },
      {
        id: decodeEventId("event-2"),
        start: { date: "2026-06-22" },
        end: { date: "2026-06-23" },
      },
    ]);
  });

  test("keeps concurrent paginated resource calendars isolated", async () => {
    listEvents = mock<ListEventsImplementation>(async (params) => ({
      data: {
        items: [
          {
            id: `${params.calendarId}-${params.pageToken ? "second" : "first"}`,
          },
        ],
        ...(!params.pageToken && {
          nextPageToken: `${params.calendarId}-next-page`,
        }),
      },
    }));

    const [workspaceEvents, salesEvents] = await runWithCalendar(
      Effect.gen(function* () {
        const googleCalendar = yield* GoogleCalendarService;

        return yield* Effect.all([
          googleCalendar.listEvents({
            calendarId: workspaceLimitationsCalendarId,
            from: "2026-06-20",
            to: "2026-06-21",
          }),
          googleCalendar.listEvents({
            calendarId: salesCalendarId,
            from: "2026-06-20",
            to: "2026-06-21",
          }),
        ]);
      })
    );

    expect(workspaceEvents.map(({ id }) => id)).toEqual([
      decodeEventId("workspace-limitations-calendar-first"),
      decodeEventId("workspace-limitations-calendar-second"),
    ]);
    expect(salesEvents.map(({ id }) => id)).toEqual([
      decodeEventId("sales-calendar-first"),
      decodeEventId("sales-calendar-second"),
    ]);
    expect(listEvents).toHaveBeenCalledTimes(4);
    expect(
      listEvents.mock.calls.map(([query]) => ({
        calendarId: query.calendarId,
        pageToken: query.pageToken,
      }))
    ).toEqual(
      expect.arrayContaining([
        {
          calendarId: "workspace-limitations-calendar",
          pageToken: undefined,
        },
        {
          calendarId: "workspace-limitations-calendar",
          pageToken: "workspace-limitations-calendar-next-page",
        },
        { calendarId: "sales-calendar", pageToken: undefined },
        {
          calendarId: "sales-calendar",
          pageToken: "sales-calendar-next-page",
        },
      ])
    );
  });

  test("maps provider errors", async () => {
    listEvents = mock<ListEventsImplementation>(async () => {
      const error = new Error("Forbidden");
      Object.assign(error, { status: 403 });
      throw error;
    });

    const result = await runWithCalendar(
      Effect.gen(function* () {
        const googleCalendar = yield* GoogleCalendarService;
        return yield* googleCalendar
          .listEvents({
            calendarId,
            from: "2026-06-20",
            to: "2026-06-21",
          })
          .pipe(Effect.result);
      })
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toMatchObject({
        _tag: "GoogleCalendarAPIError",
        operation: "events.list",
        statusCode: 403,
        message: "Forbidden",
      });
    }
  });

  test("creates an event notification channel", async () => {
    watchEvents = mock<WatchEventsImplementation>(async () => ({
      data: {
        id: "returned-channel-id",
        resourceId: "resource-id",
        resourceUri:
          "https://www.googleapis.com/calendar/v3/calendars/calendar-id/events",
        expiration: "1785902400000",
      },
    }));

    const result = await runWithCalendar(
      Effect.gen(function* () {
        const googleCalendar = yield* GoogleCalendarService;
        return yield* googleCalendar.watchEvents({
          calendarId,
          channelId: requestedChannelId,
          webhookUrl:
            "https://bar.example.test/api/webhooks/google-calendar/opening-hours",
          webhookToken: "derived-webhook-token",
          ttlSeconds: 259_200,
        });
      })
    );

    expect(watchEvents).toHaveBeenCalledWith(
      {
        calendarId: "calendar-id",
        requestBody: {
          address:
            "https://bar.example.test/api/webhooks/google-calendar/opening-hours",
          id: "requested-channel-id",
          params: { ttl: "259200" },
          token: "derived-webhook-token",
          type: "web_hook",
        },
      },
      { signal: expect.any(AbortSignal) }
    );
    expect(result).toEqual({
      channelId: decodeChannelId("returned-channel-id"),
      resourceId: decodeResourceId("resource-id"),
      resourceUri:
        "https://www.googleapis.com/calendar/v3/calendars/calendar-id/events",
      expiration: 1_785_902_400_000,
    });
  });

  test("keeps the channel token out of event watch failures", async () => {
    watchEvents = mock<WatchEventsImplementation>(async (params) => {
      const requestConfig = {
        url: "https://www.googleapis.com/calendar/v3/calendars/calendar-id/events/watch",
        data: params.requestBody,
        body: JSON.stringify(params.requestBody),
      };
      const error = new Error("Invalid webhook address");
      Object.assign(error, {
        status: 400,
        config: requestConfig,
        response: { status: 400, config: { ...requestConfig } },
      });
      throw error;
    });

    const result = await runWithCalendar(
      Effect.gen(function* () {
        const googleCalendar = yield* GoogleCalendarService;
        return yield* googleCalendar
          .watchEvents({
            calendarId,
            channelId: decodeChannelId("channel-id"),
            webhookUrl: "https://bar.example.test/webhook",
            webhookToken: "derived-webhook-token",
            ttlSeconds: 259_200,
          })
          .pipe(Effect.flip);
      })
    );

    expect(result).toMatchObject({
      _tag: "GoogleCalendarAPIError",
      operation: "events.watch",
      statusCode: 400,
      message: "Invalid webhook address",
    });
    expect(JSON.stringify(result)).not.toContain("derived-webhook-token");
    expect(Bun.inspect(result.cause, { depth: 10 })).not.toContain(
      "derived-webhook-token"
    );
  });

  test("times out and aborts a stalled events request after its retry", async () => {
    let aborted = 0;
    listEvents = mock<ListEventsImplementation>((_params, options) =>
      stalledRequest(options, () => {
        aborted += 1;
      })
    );

    const result = await runWithCalendar(
      listEventsAdvancingClock(["10 seconds", "1 second", "10 seconds"])
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "GoogleCalendarAPIError",
        operation: "events.list",
        message: "Google Calendar request timed out.",
      },
    });
    expect(listEvents).toHaveBeenCalledTimes(2);
    expect(aborted).toBe(2);
  });

  test.each([429, 503])(
    "retries an events request answered with HTTP %i",
    async (status) => {
      let attempt = 0;
      listEvents = mock<ListEventsImplementation>(async () => {
        attempt += 1;
        if (attempt === 1) throw providerError(status, "Try again");
        return { data: { items: [] } };
      });

      const result = await runWithCalendar(
        listEventsAdvancingClock(["1 second"])
      );

      expect(result).toMatchObject({ _tag: "Success", success: [] });
      expect(listEvents).toHaveBeenCalledTimes(2);
    }
  );

  test("does not retry an events request rejected as a client error", async () => {
    listEvents = mock<ListEventsImplementation>(async () => {
      throw providerError(404, "Not Found");
    });

    const result = await runWithCalendar(
      listEventsAdvancingClock(["1 second"])
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { statusCode: 404 },
    });
    expect(listEvents).toHaveBeenCalledTimes(1);
  });

  test("times each attempt out at the configured request timeout", async () => {
    let attempt = 0;
    listEvents = mock<ListEventsImplementation>((_params, options) => {
      attempt += 1;
      return attempt === 1
        ? stalledRequest(options)
        : Promise.resolve({ data: { items: [] } });
    });

    const result = await runWithCalendar(
      listEventsAdvancingClock(["5 seconds", "1 second"]),
      { ...config, requestTimeout: "5 seconds" }
    );

    expect(result).toMatchObject({ _tag: "Success", success: [] });
    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  test("bounds every page of one load by the worst case of one retried request", async () => {
    let answerFirstPage: (() => void) | undefined;
    listEvents = mock<ListEventsImplementation>((params, options) =>
      params.pageToken === undefined
        ? new Promise((resolve) => {
            answerFirstPage = () =>
              resolve({ data: { items: [], nextPageToken: "next" } });
          })
        : stalledRequest(options)
    );
    const settle = Effect.promise(
      () => new Promise((resolve) => setTimeout(resolve, 0))
    );

    const result = await runWithCalendar(
      Effect.gen(function* () {
        const googleCalendar = yield* GoogleCalendarService;
        const fiber = yield* googleCalendar
          .listEvents({ calendarId, from: "2026-06-20", to: "2026-06-21" })
          .pipe(Effect.result, Effect.forkChild);
        // The first page answers within its own timeout, after 9 seconds.
        yield* TestClock.adjust("9 seconds");
        answerFirstPage?.();
        yield* settle;
        // The second page times out at 19 seconds and is retried; the whole
        // load ends at the 20.12-second worst case, not the retry's own 29.
        yield* TestClock.adjust("10 seconds");
        yield* settle;
        yield* TestClock.adjust("1200 millis");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );

    expect(
      Duration.toMillis(getGoogleCalendarRequestWorstCaseDuration("10 seconds"))
    ).toBe(20_120);
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        operation: "events.list",
        message: "Google Calendar request timed out.",
      },
    });
    expect(listEvents).toHaveBeenCalledTimes(3);
  });

  test.each(["id", "iCalUID", "recurringEventId"] as const)(
    "rejects an empty provider event %s",
    async (field) => {
      listEvents = mock<ListEventsImplementation>(async () => ({
        data: { items: [{ [field]: "" }] },
      }));

      const result = await runWithCalendar(
        Effect.gen(function* () {
          const googleCalendar = yield* GoogleCalendarService;
          return yield* googleCalendar
            .listEvents({
              calendarId,
              from: "2026-06-20",
              to: "2026-06-21",
            })
            .pipe(Effect.result);
        })
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "GoogleCalendarAPIError",
          operation: "events.list",
          message: "Google Calendar returned a malformed identifier.",
        },
      });
    }
  );

  test.each(["id", "resourceId"] as const)(
    "rejects an empty provider watch-channel %s",
    async (field) => {
      watchEvents = mock<WatchEventsImplementation>(async () => ({
        data: { [field]: "" },
      }));

      const result = await runWithCalendar(
        Effect.gen(function* () {
          const googleCalendar = yield* GoogleCalendarService;
          return yield* googleCalendar
            .watchEvents({
              calendarId,
              channelId: requestedChannelId,
              webhookUrl: "https://bar.example.test/webhook",
              webhookToken: "derived-webhook-token",
              ttlSeconds: 259_200,
            })
            .pipe(Effect.result);
        })
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "GoogleCalendarAPIError",
          operation: "events.watch",
          message: "Google Calendar returned a malformed identifier.",
        },
      });
    }
  );

  test("fails empty config", async () => {
    const result = await Effect.runPromise(
      GoogleCalendarService.pipe(
        Effect.provide(
          GoogleCalendarService.Default.pipe(
            Layer.provide(
              Layer.succeed(GoogleCalendarRuntimeConfig, {
                ...config,
                privateKey: "",
              })
            )
          )
        ),
        Effect.result
      )
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("GoogleCalendarConfigError");
    }
  });
});
