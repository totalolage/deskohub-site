// seam: status client from @deskohub/email-posthog
import {
  Data,
  type Duration,
  Effect,
  type Redacted,
  Schema,
  SchemaTransformation,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

/** PostHog's status of one transactional email. */
export type PostHogEmailStatus =
  | "queued"
  | "sent"
  | "failed"
  | "delivered"
  | "bounced"
  | "complained";

/** PostHog's report of one email's current status. */
export interface PostHogEmailStatusReport {
  readonly messageId: string;
  readonly status: PostHogEmailStatus;
  readonly createdAt: Date;
  readonly statusAt: Date | null;
  readonly reason: string | null;
}

/** A status read, or PostHog not knowing the message yet. */
export type PostHogEmailStatusLookup =
  | { readonly _tag: "Found"; readonly report: PostHogEmailStatusReport }
  | { readonly _tag: "NotFoundYet" };

/** Why PostHog gave no status. */
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

export interface PostHogEmailStatusClientConfig {
  readonly secretKey: Redacted.Redacted<string>;
  readonly host: string;
  readonly timeout?: Duration.Input;
}

const postHogEmailStatuses = [
  "queued",
  "sent",
  "failed",
  "delivered",
  "bounced",
  "complained",
] as const satisfies readonly PostHogEmailStatus[];

const instantSchema = Schema.String.pipe(
  Schema.decodeTo(Schema.DateValid, SchemaTransformation.dateFromString)
);

const statusResponseSchema = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(postHogEmailStatuses),
  created_at: instantSchema,
  status_at: Schema.NullOr(instantSchema),
  reason: Schema.NullOr(Schema.String),
});

/** Requests that time out without a configured limit give up after this. */
const defaultTimeout: Duration.Input = "10 seconds";

/**
 * What went wrong in an HTTP client failure, without the failed request,
 * whose headers carry the secret key.
 */
const requestFreeCause = (error: HttpClientError.HttpClientError) =>
  error.reason.cause ?? error.reason._tag;

const decodeStatusBody = Schema.decodeEffect(
  Schema.fromJsonString(statusResponseSchema)
);

/**
 * Reads a status body. A body that stops arriving fails like any other
 * transport failure; one that arrives but does not parse is invalid.
 */
const readReport = (response: HttpClientResponse.HttpClientResponse) =>
  response.text.pipe(
    Effect.flatMap((text) =>
      decodeStatusBody(text).pipe(
        Effect.mapError(
          (cause) =>
            new PostHogEmailStatusError({ reason: "invalid-response", cause })
        )
      )
    ),
    Effect.map(
      (body): PostHogEmailStatusLookup => ({
        _tag: "Found",
        report: {
          messageId: body.id,
          status: body.status,
          createdAt: body.created_at,
          statusAt: body.status_at,
          reason: body.reason,
        },
      })
    )
  );

const statusFailure =
  (reason: PostHogEmailStatusError["reason"]) =>
  (response: HttpClientResponse.HttpClientResponse) =>
    Effect.fail(
      new PostHogEmailStatusError({
        reason,
        cause: { httpStatus: response.status },
      })
    );

/** The wait a `Retry-After` header asks for, when it gives whole seconds. */
const retryAfterSeconds = (
  response: HttpClientResponse.HttpClientResponse
): number | undefined => {
  const retryAfter = response.headers["retry-after"]?.trim();
  return retryAfter && /^\d+$/.test(retryAfter)
    ? Number(retryAfter)
    : undefined;
};

const rateLimited = (response: HttpClientResponse.HttpClientResponse) => {
  const cause = { httpStatus: response.status };
  const seconds = retryAfterSeconds(response);
  return Effect.fail(
    seconds === undefined
      ? new PostHogEmailStatusError({ reason: "rate-limited", cause })
      : new PostHogEmailStatusError({
          reason: "rate-limited",
          cause,
          retryAfterSeconds: seconds,
        })
  );
};

/** Reads PostHog's status of one email by its message ID. */
export const fetchPostHogEmailStatus: (
  config: PostHogEmailStatusClientConfig,
  messageId: string
) => Effect.Effect<PostHogEmailStatusLookup, PostHogEmailStatusError> =
  Effect.fn("PostHogEmailStatusClient.fetchStatus")(
    function* (config: PostHogEmailStatusClientConfig, messageId: string) {
      const httpClient = yield* HttpClient.HttpClient;
      const request = HttpClientRequest.get(
        `${config.host.replace(/\/$/, "")}/api/projects/@current/messaging/emails/${encodeURIComponent(messageId)}/`
      ).pipe(HttpClientRequest.bearerToken(config.secretKey));
      const response = yield* httpClient.execute(request);
      return yield* HttpClientResponse.matchStatus(response, {
        200: readReport,
        404: () =>
          Effect.succeed<PostHogEmailStatusLookup>({ _tag: "NotFoundYet" }),
        401: statusFailure("unauthorized"),
        403: statusFailure("unauthorized"),
        429: rateLimited,
        "4xx": statusFailure("rejected"),
        "5xx": statusFailure("unavailable"),
        orElse: statusFailure("invalid-response"),
      });
    },
    (lookup, config) =>
      lookup.pipe(
        Effect.timeout(config.timeout ?? defaultTimeout),
        Effect.catchTags({
          HttpClientError: (error) =>
            Effect.fail(
              new PostHogEmailStatusError({
                reason: "unavailable",
                cause: requestFreeCause(error),
              })
            ),
          TimeoutError: (cause) =>
            Effect.fail(
              new PostHogEmailStatusError({ reason: "unavailable", cause })
            ),
        }),
        Effect.provide(FetchHttpClient.layer)
      )
  );
