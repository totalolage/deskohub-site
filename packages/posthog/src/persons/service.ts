import { Context, type Duration, Effect, Layer, type Redacted } from "effect";
import type { SchemaError } from "effect/Schema";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
} from "effect/unstable/http";
import type { PersonBulkDeleteResponse } from "../generated/effect.gen";
import type { PostHogDistinctId, PostHogProjectId } from "../identifiers";
import { makePostHogManagementClient } from "../management-client";
import {
  type PostHogPersonsOperation,
  PostHogPersonsRejected,
  type PostHogPersonsRequest,
  PostHogPersonsUnavailable,
  PostHogPersonsUncertain,
  type PostHogPersonsWriteFailure,
} from "./errors";
import { getPostHogPersonsRequestPolicy } from "./request-policy";

export interface PostHogPersonsConfigInput {
  /** A personal API key with the `person:write` scope. */
  readonly apiKey: Redacted.Redacted<string>;
  /** The private API host, such as `https://eu.posthog.com`. */
  readonly host: URL;
  readonly projectId: PostHogProjectId;
  /** How long one attempt may take, chosen by the deployment. */
  readonly attemptTimeout: Duration.Input;
}

export class PostHogPersonsConfig extends Context.Service<
  PostHogPersonsConfig,
  PostHogPersonsConfigInput
>()("@deskohub/posthog/PostHogPersonsConfig") {
  static from = (config: PostHogPersonsConfigInput) =>
    Layer.succeed(this, config);
}

/**
 * - `deleted`: PostHog deleted the person, or queued its deletion.
 * - `absent`: PostHog found no person for the distinct id.
 * - `skipped`: `proceed` said no before an attempt; that attempt sent nothing.
 */
export type PostHogPersonDeletion = "deleted" | "absent" | "skipped";

export interface IPostHogPersonsService {
  /** Deletes the person behind a distinct id and keeps its events and recordings. */
  readonly deletePersonKeepingEvents: (input: {
    readonly distinctId: PostHogDistinctId;
    /** Checked before every attempt, including retries; false stops without sending. Defaults to always proceeding. */
    readonly proceed?: Effect.Effect<boolean>;
  }) => Effect.Effect<PostHogPersonDeletion, PostHogPersonsWriteFailure>;
}

const bulkDelete = {
  operation: "deletePersonKeepingEvents",
  request: "persons.bulkDelete",
} as const satisfies {
  readonly operation: PostHogPersonsOperation;
  readonly request: PostHogPersonsRequest;
};

export class PostHogPersonsService extends Context.Service<
  PostHogPersonsService,
  IPostHogPersonsService
>()("@deskohub/posthog/PostHogPersonsService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* PostHogPersonsConfig;
      const client = makePostHogManagementClient(
        yield* HttpClient.HttpClient,
        config
      );
      const policy = getPostHogPersonsRequestPolicy(
        bulkDelete.request,
        config.attemptTimeout
      );

      const sendBulkDelete = (distinctId: PostHogDistinctId) =>
        client
          .personsBulkDeleteCreate(config.projectId, {
            payload: {
              distinct_ids: [distinctId],
              delete_events: false,
              delete_recordings: false,
            },
          })
          .pipe(
            Effect.mapError(classifyRequestFailure),
            Effect.flatMap(toDeletion),
            policy.attempt(
              () =>
                new PostHogPersonsUncertain({
                  ...bulkDelete,
                  reason: "timeout",
                  message: "The PostHog person deletion timed out.",
                })
            )
          );

      return {
        deletePersonKeepingEvents: Effect.fn(
          "PostHogPersonsService.deletePersonKeepingEvents"
        )(function* ({ distinctId, proceed = Effect.succeed(true) }) {
          return yield* Effect.gen(function* () {
            if (!(yield* proceed)) return "skipped" as const;
            return yield* sendBulkDelete(distinctId);
          }).pipe(policy.retryWhile(isUnavailable));
        }),
      } satisfies IPostHogPersonsService;
    })
  );

  static Live = (input: PostHogPersonsConfigInput) =>
    this.Default.pipe(
      Layer.provide(
        Layer.mergeAll(PostHogPersonsConfig.from(input), FetchHttpClient.layer)
      )
    );
}

/**
 * The longest one deletePersonKeepingEvents call can take when every attempt
 * times out and every backoff draws the maximum jitter, excluding `proceed`.
 */
export const getPostHogPersonDeletionWorstCase = (
  attemptTimeout: Duration.Input
): Duration.Duration =>
  getPostHogPersonsRequestPolicy(bulkDelete.request, attemptTimeout).worstCase
    .retried;

/**
 * Deletion steps whose failure still leaves the person deleted, so a retry
 * would not find it (PostHog's `deletion_errors` documentation).
 */
const stepsAfterPersonDeleted: ReadonlySet<string> = new Set([
  "log_activity",
  "publish_clickhouse_tombstone",
]);

/**
 * Only deletion errors that name a step before the person was deleted prove
 * it still exists and can be retried; an entry without a step proves nothing.
 */
const toDeletion = (
  response: PersonBulkDeleteResponse
): Effect.Effect<
  "deleted" | "absent",
  PostHogPersonsUnavailable | PostHogPersonsUncertain
> => {
  if (response.persons_found === 0) return Effect.succeed("absent");
  const steps = (response.deletion_errors ?? []).map((entry) => entry.step);
  const namedSteps = steps.filter(
    (step): step is string => typeof step === "string"
  );
  if (namedSteps.length < steps.length) {
    return Effect.fail(
      new PostHogPersonsUncertain({
        ...bulkDelete,
        reason: "invalid-response",
        message: "PostHog reported a deletion error without its step.",
      })
    );
  }
  return namedSteps.every((step) => stepsAfterPersonDeleted.has(step))
    ? Effect.succeed("deleted")
    : Effect.fail(
        new PostHogPersonsUnavailable({
          ...bulkDelete,
          reason: "deletion-incomplete",
          message: "PostHog did not finish deleting the person.",
        })
      );
};

const isUnavailable = (
  failure: PostHogPersonsWriteFailure
): failure is PostHogPersonsUnavailable =>
  failure._tag === "PostHogPersonsUnavailable";

/**
 * Classifies a failed bulk delete. Only a 429 proves nothing was applied; any
 * failure after the request may have reached PostHog is uncertain. The HTTP
 * client error is dropped, because its request carries the distinct id.
 */
const classifyRequestFailure = (
  error: HttpClientError.HttpClientError | SchemaError
): PostHogPersonsWriteFailure => {
  if (!HttpClientError.isHttpClientError(error)) {
    return new PostHogPersonsUncertain({
      ...bulkDelete,
      reason: "invalid-response",
      message: "PostHog answered the person deletion with an unreadable body.",
    });
  }
  const { reason } = error;
  switch (reason._tag) {
    case "StatusCodeError":
      return classifyStatus(reason.response.status);
    case "DecodeError":
    case "EmptyBodyError":
      return new PostHogPersonsUncertain({
        ...bulkDelete,
        reason: "invalid-response",
        httpStatus: reason.response.status,
        message:
          "PostHog answered the person deletion with an unreadable body.",
      });
    case "TransportError":
      return new PostHogPersonsUncertain({
        ...bulkDelete,
        reason: "transport",
        message: "The PostHog person deletion failed in transport.",
      });
    case "EncodeError":
    case "InvalidUrlError":
      return new PostHogPersonsRejected({
        ...bulkDelete,
        reason: "invalid-request",
        message: "The PostHog person deletion could not be sent.",
      });
  }
};

const classifyStatus = (httpStatus: number): PostHogPersonsWriteFailure => {
  if (httpStatus === 429) {
    return new PostHogPersonsUnavailable({
      ...bulkDelete,
      reason: "rate-limited",
      httpStatus,
      message: "PostHog rate-limited the person deletion.",
    });
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return new PostHogPersonsRejected({
      ...bulkDelete,
      reason: "unauthorized",
      httpStatus,
      message: "PostHog refused the API key for the person deletion.",
    });
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    return new PostHogPersonsRejected({
      ...bulkDelete,
      reason: "invalid-request",
      httpStatus,
      message: "PostHog rejected the person deletion request.",
    });
  }
  return new PostHogPersonsUncertain({
    ...bulkDelete,
    reason: "server",
    httpStatus,
    message: "PostHog failed the person deletion with a server error.",
  });
};
