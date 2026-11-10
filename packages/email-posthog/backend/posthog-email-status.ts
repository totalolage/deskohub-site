import { Data, Duration, Effect, Match, Redacted, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/unstable/http";
import {
  type PostHogEmailConnection,
  postHogAppHost,
  postHogEmailAttemptTimeout,
} from "./posthog-email-connection";
import { readRetryAfter } from "./posthog-email-response";

/** What happened to an email PostHog queued. */
export type PostHogEmailStatus =
  | "queued"
  | "sent"
  | "failed"
  | "delivered"
  | "bounced"
  | "complained";

/** PostHog's report of one email it queued. */
export interface PostHogEmailStatusReport {
  /** The message id the send returned. */
  readonly messageId: string;
  readonly status: PostHogEmailStatus;
  /** When PostHog queued the email. */
  readonly createdAt: Date;
  /** When the email reached its status, when PostHog says. */
  readonly statusAt: Date | null;
  /** Why a failed email was not sent, or a bounce type (`hard`, `soft`, `unknown`). */
  readonly reason: string | null;
}

/**
 * `NotFoundYet`: PostHog does not know the message, which happens for a few
 * seconds after a send and after its 30-day retention.
 */
export type PostHogEmailStatusLookup =
  | { readonly _tag: "Found"; readonly report: PostHogEmailStatusReport }
  | { readonly _tag: "NotFoundYet" };

/**
 * A status read that failed; nothing is retried inside the read.
 *
 * - `rate-limited`: HTTP 429; `retryAfterSeconds` carries a readable `Retry-After`.
 * - `unauthorized`: HTTP 401 or 403; the secret key lacks a `transactional_email` scope.
 * - `rejected`: any other 4xx.
 * - `unavailable`: 5xx, a transport failure, or a timeout.
 * - `invalid-response`: an unreadable body or a status this client does not know.
 */
export class PostHogEmailStatusError extends Data.TaggedError(
  "PostHogEmailStatusError"
)<{
  readonly reason:
    | "rate-limited"
    | "unauthorized"
    | "rejected"
    | "unavailable"
    | "invalid-response";
  readonly retryAfterSeconds?: number;
  readonly cause?: unknown;
}> {}

/** The secret key needs `transactional_email:read` or `:write`. */
export type PostHogEmailStatusClientConfig = PostHogEmailConnection;

const statusPath = "/api/projects/@current/messaging/emails/";

const StatusAnswerSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  status: Schema.Literals([
    "queued",
    "sent",
    "failed",
    "delivered",
    "bounced",
    "complained",
  ]),
  created_at: Schema.String,
  status_at: Schema.optional(Schema.NullOr(Schema.String)),
  reason: Schema.optional(Schema.NullOr(Schema.String)),
});

/**
 * Reads the status of one email PostHog queued, by the message id its send
 * returned. One request, bounded by the connection's timeout; the caller
 * decides when to read again.
 */
export const fetchPostHogEmailStatus = Effect.fn("PostHogEmailStatus.fetch")(
  function* (config: PostHogEmailStatusClientConfig, messageId: string) {
    const timeout = yield* postHogEmailAttemptTimeout(config);
    const httpClient = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(
      `${postHogAppHost(config.host)}${statusPath}${encodeURIComponent(messageId)}/`
    ).pipe(
      HttpClientRequest.bearerToken(Redacted.value(config.secretKey)),
      HttpClientRequest.acceptJson
    );

    return yield* httpClient.execute(request).pipe(
      // The transport failure carries the request and its secret key, so it
      // is not kept as the cause.
      Effect.mapError(
        () => new PostHogEmailStatusError({ reason: "unavailable" })
      ),
      Effect.flatMap(toLookup),
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          Effect.fail(new PostHogEmailStatusError({ reason: "unavailable" })),
      })
    );
  },
  Effect.provide(FetchHttpClient.layer)
);

const toLookup = (response: HttpClientResponse.HttpClientResponse) =>
  Match.value(response.status).pipe(
    Match.when(404, () =>
      Effect.succeed<PostHogEmailStatusLookup>({ _tag: "NotFoundYet" })
    ),
    Match.when(
      (status) => status >= 200 && status < 300,
      () => decodeReport(response)
    ),
    Match.orElse((status) =>
      Effect.flatMap(refusal(response, status), Effect.fail)
    )
  );

const refusal = (
  response: HttpClientResponse.HttpClientResponse,
  status: number
) =>
  Effect.map(readRetryAfter(response), (retryAfter) => {
    if (status === 429) {
      return new PostHogEmailStatusError({
        reason: "rate-limited",
        ...(retryAfter !== undefined && {
          retryAfterSeconds: Math.ceil(Duration.toSeconds(retryAfter)),
        }),
      });
    }
    if (status === 401 || status === 403) {
      return new PostHogEmailStatusError({ reason: "unauthorized" });
    }
    return new PostHogEmailStatusError({
      reason: status >= 400 && status < 500 ? "rejected" : "unavailable",
    });
  });

const decodeReport = (response: HttpClientResponse.HttpClientResponse) =>
  response.text.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.fromJsonString(StatusAnswerSchema))
    ),
    Effect.flatMap((answer) => {
      const createdAt = parseTime(answer.created_at);
      const statusAt = answer.status_at ? parseTime(answer.status_at) : null;
      return createdAt === undefined || statusAt === undefined
        ? Effect.fail("unreadable time")
        : Effect.succeed<PostHogEmailStatusLookup>({
            _tag: "Found",
            report: {
              messageId: answer.id,
              status: answer.status,
              createdAt,
              statusAt,
              reason: answer.reason || null,
            },
          });
    }),
    Effect.mapError(
      () => new PostHogEmailStatusError({ reason: "invalid-response" })
    )
  );

/** An ISO 8601 time, or `undefined` when unreadable. */
const parseTime = (value: string) => {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? undefined : time;
};
