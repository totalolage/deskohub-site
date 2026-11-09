import * as Schema from "effect/Schema";

/** Every public PostHogPersonsService operation. errors.test.ts pins this to keyof IPostHogPersonsService. */
export const PostHogPersonsOperation = Schema.Literals([
  "deletePersonKeepingEvents",
]);
export type PostHogPersonsOperation = typeof PostHogPersonsOperation.Type;

/**
 * The wire request that failed. Diagnostic only. The package's private retry
 * ceilings are keyed by these names.
 */
export const PostHogPersonsRequest = Schema.Literals(["persons.bulkDelete"]);
export type PostHogPersonsRequest = typeof PostHogPersonsRequest.Type;

/**
 * No `cause`: the HTTP client error carries the request, whose body holds the
 * distinct id.
 */
const PostHogPersonsFailureBase = Schema.Struct({
  operation: PostHogPersonsOperation,
  /** Absent when the failure came before any request. */
  request: Schema.optional(PostHogPersonsRequest),
  /** Diagnostic only, for logs and support. Code never branches on it. */
  httpStatus: Schema.optional(Schema.Int),
  /** Human detail without identifiers, credentials or provider bodies. */
  message: Schema.optional(Schema.String),
});

/** PostHog could not serve the request. Nothing was applied, and the package's retries are spent. */
export class PostHogPersonsUnavailable extends Schema.TaggedErrorClass<PostHogPersonsUnavailable>()(
  "PostHogPersonsUnavailable",
  {
    ...PostHogPersonsFailureBase.fields,
    reason: Schema.Literals(["rate-limited", "deletion-incomplete"]),
  }
) {}

/** PostHog refused the request in a way a retry would repeat. Nothing was applied. */
export class PostHogPersonsRejected extends Schema.TaggedErrorClass<PostHogPersonsRejected>()(
  "PostHogPersonsRejected",
  {
    ...PostHogPersonsFailureBase.fields,
    reason: Schema.Literals(["unauthorized", "invalid-request"]),
  }
) {}

/** The deletion may have been applied. Settle it before acting. Reads never raise it. */
export class PostHogPersonsUncertain extends Schema.TaggedErrorClass<PostHogPersonsUncertain>()(
  "PostHogPersonsUncertain",
  {
    ...PostHogPersonsFailureBase.fields,
    reason: Schema.Literals([
      "server",
      "transport",
      "timeout",
      "invalid-response",
    ]),
  }
) {}

export type PostHogPersonsReadFailure =
  | PostHogPersonsUnavailable
  | PostHogPersonsRejected;
export type PostHogPersonsWriteFailure =
  | PostHogPersonsReadFailure
  | PostHogPersonsUncertain;

/**
 * Stable, low-cardinality machine codes, one per tag. Failure codes, metrics
 * and log annotations use these instead of HTTP statuses. `satisfies` makes a
 * new tag without a code a type error.
 */
export const PostHogPersonsFailureCode = {
  PostHogPersonsUnavailable: "posthog-persons-unavailable",
  PostHogPersonsRejected: "posthog-persons-rejected",
  PostHogPersonsUncertain: "posthog-persons-uncertain",
} as const satisfies Record<
  PostHogPersonsWriteFailure["_tag"],
  `posthog-persons-${string}`
>;
export type PostHogPersonsFailureCode =
  (typeof PostHogPersonsFailureCode)[PostHogPersonsWriteFailure["_tag"]];

export const postHogPersonsFailureCode = (
  failure: PostHogPersonsWriteFailure
): PostHogPersonsFailureCode => PostHogPersonsFailureCode[failure._tag];

/**
 * The log fields every log site attaches to a PostHog persons failure. It is
 * the only reader of httpStatus outside the package's request handling, so
 * call sites never touch the status.
 */
export const postHogPersonsFailureLogFields = (
  failure: PostHogPersonsWriteFailure
): {
  readonly postHogPersonsCode: PostHogPersonsFailureCode;
  readonly postHogPersonsReason: PostHogPersonsWriteFailure["reason"];
  readonly postHogPersonsOperation: PostHogPersonsOperation;
  readonly postHogPersonsRequest: PostHogPersonsRequest | undefined;
  readonly postHogPersonsHttpStatus: number | undefined;
} => ({
  postHogPersonsCode: postHogPersonsFailureCode(failure),
  postHogPersonsReason: failure.reason,
  postHogPersonsOperation: failure.operation,
  postHogPersonsRequest: failure.request,
  postHogPersonsHttpStatus: failure.httpStatus,
});
