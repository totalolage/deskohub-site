import { Context, Effect, Layer, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { env } from "@/env";
import type { AdministrationTimelineItem } from "./administration.service";

const lifecycleEvents = [
  "reservation started",
  "reservation abandoned",
  "reservation completed",
  "reservation fulfilled",
  "payment started",
  "payment completed",
  "payment abandoned",
  "payment failed",
] as const;

const lifecycleEventSchema = Schema.Literals(lifecycleEvents);

const postHogHistoryResponseSchema = Schema.Struct({
  results: Schema.Array(
    Schema.Tuple([
      lifecycleEventSchema,
      Schema.String,
      Schema.String,
      Schema.Union([Schema.String, Schema.Null]),
      Schema.Union([Schema.String, Schema.Null]),
    ])
  ),
});

const eventPresentation = {
  "reservation started": {
    title: "Reservation held",
    description: "The booking was held for the customer.",
    tone: "neutral",
  },
  "reservation abandoned": {
    title: "Reservation cancelled",
    description: "The reservation was cancelled.",
    tone: "warning",
  },
  "reservation completed": {
    title: "Reservation confirmed",
    description: "The reservation was confirmed.",
    tone: "positive",
  },
  "reservation fulfilled": {
    title: "Customer access sent",
    description: "The customer confirmation was sent.",
    tone: "positive",
  },
  "payment started": {
    title: "Payment started",
    description: "An online payment attempt began.",
    tone: "neutral",
  },
  "payment completed": {
    title: "Payment received",
    description: "The payment was received.",
    tone: "positive",
  },
  "payment abandoned": {
    title: "Payment unsuccessful",
    description: "A payment was cancelled or expired.",
    tone: "warning",
  },
  "payment failed": {
    title: "Payment failed",
    description: "An online payment attempt failed.",
    tone: "warning",
  },
} as const satisfies Record<
  (typeof lifecycleEvents)[number],
  Pick<AdministrationTimelineItem, "title" | "description" | "tone">
>;

export type ReservationHistoryResult =
  | {
      readonly kind: "available";
      readonly items: readonly AdministrationTimelineItem[];
    }
  | { readonly kind: "unavailable" };

export type PostHogHistoryConfig = {
  readonly apiKey?: string;
  readonly environment: string;
  readonly host?: string;
  readonly projectId?: string;
  readonly serviceName: string;
};

export class PostHogHistoryRuntimeConfig extends Context.Service<
  PostHogHistoryRuntimeConfig,
  PostHogHistoryConfig
>()("@deskohub-workspace/administration/PostHogHistoryRuntimeConfig") {
  static Live = Layer.succeed(this, {
    apiKey: env.POSTHOG_HISTORY_API_KEY,
    environment: env.VERCEL_ENV,
    host: env.POSTHOG_HOST,
    projectId: env.POSTHOG_PROJECT_ID,
    serviceName: env.POSTHOG_SERVICE_NAME,
  });
}

const reservationHistoryQuery = `
SELECT
  event,
  toString(timestamp),
  uuid,
  properties.payment_attempt_id,
  properties.provider
FROM events
WHERE distinct_id = {reservationId}
  AND properties.reservation_id = {reservationId}
  AND properties.\`deployment.environment.name\` = {environment}
  AND properties.\`service.name\` = {serviceName}
  AND event IN (${lifecycleEvents.map((event) => `'${event}'`).join(", ")})
ORDER BY timestamp ASC, uuid ASC
LIMIT 100`;

const normalizePostHogTimestamp = (value: string) => {
  try {
    return Temporal.Instant.from(value).toString();
  } catch {
    return Temporal.Instant.from(`${value}Z`).toString();
  }
};

export class PostHogReservationHistory extends Context.Service<
  PostHogReservationHistory,
  {
    readonly load: (
      workspaceReservationId: string
    ) => Effect.Effect<ReservationHistoryResult>;
  }
>()("@deskohub-workspace/administration/PostHogReservationHistory") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* PostHogHistoryRuntimeConfig;
      const httpClient = yield* HttpClient.HttpClient;

      const load = Effect.fn("PostHogReservationHistory.load")(
        (workspaceReservationId: string) => {
          if (!config.apiKey || !config.host || !config.projectId) {
            return Effect.succeed({
              kind: "unavailable",
            } as const satisfies ReservationHistoryResult);
          }

          const request = HttpClientRequest.post(
            `${config.host.replace(/\/$/, "")}/api/projects/${encodeURIComponent(config.projectId)}/query/`
          ).pipe(
            HttpClientRequest.setHeaders({
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
            }),
            HttpClientRequest.bodyJsonUnsafe({
              query: {
                kind: "HogQLQuery",
                query: reservationHistoryQuery,
                values: {
                  environment: config.environment,
                  reservationId: workspaceReservationId,
                  serviceName: config.serviceName,
                },
              },
              refresh: "blocking",
            })
          );

          return httpClient.execute(request).pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(postHogHistoryResponseSchema)
            ),
            Effect.map(({ results }) => ({
              kind: "available" as const,
              items: results.flatMap(([event, occurredAt, uuid]) => {
                try {
                  const normalizedTime = normalizePostHogTimestamp(occurredAt);
                  const presentation = eventPresentation[event];
                  return [
                    {
                      id: `posthog-${uuid}`,
                      ...presentation,
                      occurredAt: normalizedTime,
                    },
                  ];
                } catch {
                  return [];
                }
              }),
            })),
            Effect.timeout("5 seconds"),
            Effect.catch((cause) =>
              Effect.logWarning("Additional reservation history unavailable", {
                cause,
                workspaceReservationId,
              }).pipe(
                Effect.as({
                  kind: "unavailable",
                } as const satisfies ReservationHistoryResult)
              )
            )
          );
        }
      );

      return { load };
    })
  );

  static Default = this.Live.pipe(
    Layer.provide(PostHogHistoryRuntimeConfig.Live),
    Layer.provide(FetchHttpClient.layer)
  );
}

export const mergeReservationHistory = ({
  durable,
  history,
}: {
  readonly durable: readonly AdministrationTimelineItem[];
  readonly history: ReservationHistoryResult;
}) => {
  const durableTitles = new Set(durable.map(({ title }) => title));
  const additional =
    history.kind === "available"
      ? history.items.filter(({ title }) => !durableTitles.has(title))
      : [];
  return [...durable, ...additional].toSorted((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt)
  );
};
