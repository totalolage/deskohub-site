import {
  handleCallback,
  type MessageMetadata,
  type RetryDirective,
} from "@vercel/queue";
import { Cause, Data, Effect, Match, Predicate } from "effect";
import { isDatabaseUnavailable } from "@/db/database-unavailable";
import { env } from "@/env";
import { defineWorkspaceTask } from "@/shared/backend/workspace-effect";
import { clamp, currentInstant } from "@/shared/utils";

/** How a consumer wants the queue to treat one of its failures. */
export type QueueRedelivery = Data.TaggedEnum<{
  /** The message can never succeed: acknowledge it. */
  Never: Record<never, never>;
  /** A transient failure: redeliver with exponential backoff. */
  WithBackoff: Record<never, never>;
  /** The work becomes due at a known instant: redeliver then. */
  At: { readonly instant: Temporal.Instant };
  /** Unclassified: the queue trigger's retry delay applies. */
  Default: Record<never, never>;
}>;

export const QueueRedelivery = Data.taggedEnum<QueueRedelivery>();

type VercelEnvironment = (typeof env)["VERCEL_ENV"];

/**
 * Preview messages are synthetic and pinned to their deployment, so after this
 * many deliveries a failing one is abandoned instead of keeping the Preview
 * database awake until its retention ends.
 */
export const previewQueueDeliveryLimit = 5;

const backoffBaseSeconds = 60;
const backoffMaxSeconds = 15 * 60;
// Vercel Queues accepts visibility changes of up to one hour.
const maxRedeliveryDelaySeconds = 60 * 60;

type QueueRedeliveryReason =
  | "preview_database_unavailable"
  | "preview_delivery_limit"
  | "database_unavailable"
  | "permanent_failure"
  | "transient_failure"
  | "scheduled"
  | "unclassified";

interface QueueRedeliveryDecision {
  readonly reason: QueueRedeliveryReason;
  /** `undefined` rethrows, so the trigger's `retryAfterSeconds` applies. */
  readonly directive: RetryDirective | undefined;
}

const acknowledge = { acknowledge: true } as const;

const backoffSeconds = (deliveryCount: number) =>
  Math.min(
    backoffBaseSeconds * 2 ** (Math.max(deliveryCount, 1) - 1),
    backoffMaxSeconds
  );

// A consumer classifies only a lone typed failure. Defects, interruptions, and
// concurrent failures keep the default redelivery.
const classifyFailure = <E>(
  cause: Cause.Cause<E>,
  redelivery: (error: E) => QueueRedelivery
): QueueRedelivery => {
  const [reason, ...others] = cause.reasons;
  return reason && others.length === 0 && Cause.isFailReason(reason)
    ? redelivery(reason.error)
    : QueueRedelivery.Default();
};

/**
 * Chooses what the queue does with a failed delivery. Only a Preview
 * (`VERCEL_ENV === "preview"`, never inferred) acknowledges a message because
 * its database is gone or because it reached the delivery limit; elsewhere a
 * database outage backs off and nothing is dropped without the consumer's
 * classification.
 */
export const decideQueueRedelivery = <E>(input: {
  readonly cause: Cause.Cause<E>;
  readonly redelivery: (error: E) => QueueRedelivery;
  readonly deliveryCount: number;
  readonly environment: VercelEnvironment;
  readonly now: Temporal.Instant;
}): QueueRedeliveryDecision => {
  const databaseUnavailable = isDatabaseUnavailable(input.cause);
  if (input.environment === "preview") {
    if (databaseUnavailable) {
      return { reason: "preview_database_unavailable", directive: acknowledge };
    }
    if (input.deliveryCount >= previewQueueDeliveryLimit) {
      return { reason: "preview_delivery_limit", directive: acknowledge };
    }
  } else if (databaseUnavailable) {
    return {
      reason: "database_unavailable",
      directive: { afterSeconds: backoffSeconds(input.deliveryCount) },
    };
  }

  return Match.value(classifyFailure(input.cause, input.redelivery)).pipe(
    Match.tagsExhaustive({
      Never: (): QueueRedeliveryDecision => ({
        reason: "permanent_failure",
        directive: acknowledge,
      }),
      WithBackoff: (): QueueRedeliveryDecision => ({
        reason: "transient_failure",
        directive: { afterSeconds: backoffSeconds(input.deliveryCount) },
      }),
      At: ({ instant }): QueueRedeliveryDecision => ({
        reason: "scheduled",
        directive: {
          afterSeconds: clamp(
            Math.ceil(
              (instant.epochMilliseconds - input.now.epochMilliseconds) / 1000
            ),
            1,
            maxRedeliveryDelaySeconds
          ),
        },
      }),
      Default: (): QueueRedeliveryDecision => ({
        reason: "unclassified",
        directive: undefined,
      }),
    })
  );
};

const redeliveryLogs = {
  preview_database_unavailable: {
    level: "Warn",
    message: "Queue message acknowledged: the Preview database is unavailable",
  },
  preview_delivery_limit: {
    level: "Warn",
    message: "Queue message abandoned at the Preview delivery limit",
  },
  database_unavailable: {
    level: "Error",
    message: "Queue message redelivery backed off: database unavailable",
  },
  permanent_failure: {
    level: "Warn",
    message: "Queue message acknowledged after a permanent failure",
  },
  transient_failure: {
    level: "Warn",
    message: "Queue message redelivery backed off after a transient failure",
  },
  scheduled: {
    level: "Info",
    message: "Queue message redelivery scheduled",
  },
  unclassified: {
    level: "Error",
    message: "Queue message failed; the queue redelivers it",
  },
} as const satisfies Record<
  QueueRedeliveryReason,
  { readonly level: "Info" | "Warn" | "Error"; readonly message: string }
>;

/**
 * What escapes the task to the queue SDK. It carries only the directive: the
 * SDK prints a rethrown handler error with `console.error`, outside log
 * censorship, so the original cause is logged before this replaces it.
 */
export class QueueDeliveryFailure extends Data.TaggedError(
  "QueueDeliveryFailure"
)<{
  readonly message: string;
  readonly reason: QueueRedeliveryReason;
  readonly directive: RetryDirective | undefined;
}> {}

const logRedeliveryDecision = <E>(input: {
  readonly cause: Cause.Cause<E>;
  readonly decision: QueueRedeliveryDecision;
}) => {
  const log = redeliveryLogs[input.decision.reason];
  return Effect.logWithLevel(log.level)(log.message, {
    reason: input.decision.reason,
    directive: input.decision.directive,
    cause: input.cause,
  });
};

const toQueueDeliveryFailure = (input: {
  readonly decision: QueueRedeliveryDecision;
}) =>
  new QueueDeliveryFailure({
    message: redeliveryLogs[input.decision.reason].message,
    ...input.decision,
  });

/** Logs a failed delivery with its cause and fails with its directive. */
const failQueueDelivery = <E>(input: {
  readonly cause: Cause.Cause<E>;
  readonly redelivery: (error: E) => QueueRedelivery;
  readonly deliveryCount: number;
  readonly environment: VercelEnvironment;
}): Effect.Effect<never, QueueDeliveryFailure> =>
  Effect.succeed(input).pipe(
    Effect.bind("now", () => currentInstant),
    Effect.let("decision", decideQueueRedelivery),
    Effect.tap(logRedeliveryDecision),
    Effect.let("failure", toQueueDeliveryFailure),
    Effect.flatMap(({ failure }) => Effect.fail(failure))
  );

/**
 * Runs one delivery. A failure is logged with its cause and replaced by a
 * `QueueDeliveryFailure` that carries the redelivery directive.
 */
export const deliverQueueMessage =
  <Message, E>(input: {
    readonly consume: (message: Message) => Effect.Effect<unknown, E, never>;
    readonly redelivery: (error: E) => QueueRedelivery;
    readonly environment: VercelEnvironment;
  }) =>
  (
    message: Message,
    metadata: MessageMetadata
  ): Effect.Effect<void, E | QueueDeliveryFailure> =>
    // Suspended so a consumer that throws while building its Effect is still
    // logged and sanitized here.
    Effect.suspend(() => input.consume(message)).pipe(
      Effect.asVoid,
      Effect.catchCauseIf(Predicate.not(Cause.hasInterruptsOnly), (cause) =>
        failQueueDelivery({
          cause,
          redelivery: input.redelivery,
          deliveryCount: metadata.deliveryCount,
          environment: input.environment,
        })
      ),
      Effect.annotateLogs({
        queueTopic: metadata.topicName,
        queueMessageId: metadata.messageId,
        deliveryCount: metadata.deliveryCount,
      })
    );

/** The SDK `retry` hook: applies the directive a delivery failed with. */
export const queueRetryDirective = (cause: unknown) =>
  cause instanceof QueueDeliveryFailure ? cause.directive : undefined;

/**
 * Defines a Vercel Queue route handler. `redelivery` classifies the
 * consumer's own typed failures; anything it doesn't classify keeps the
 * trigger's default retry.
 */
export const defineQueueConsumer = <Message, E>(
  operation: string,
  consume: (message: Message) => Effect.Effect<unknown, E, never>,
  redelivery: (error: E) => QueueRedelivery = () => QueueRedelivery.Default()
) =>
  handleCallback(
    defineWorkspaceTask(
      operation,
      deliverQueueMessage({
        consume,
        redelivery,
        environment: env.VERCEL_ENV,
      })
    ),
    { retry: queueRetryDirective }
  );
