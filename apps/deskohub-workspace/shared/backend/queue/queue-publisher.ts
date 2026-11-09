import { DuplicateMessageError, send } from "@vercel/queue";
import { Context, Data, Effect, Layer } from "effect";

export class QueueMessageSendError extends Data.TaggedError(
  "QueueMessageSendError"
)<{
  readonly topic: string;
  readonly cause?: unknown;
}> {}

class DuplicateQueueMessageError extends Data.TaggedError(
  "DuplicateQueueMessageError"
) {}

/** One message as it is sent to a Vercel Queue topic. */
export type QueuePublication<Message = unknown> = {
  readonly topic: string;
  readonly message: Message;
  readonly options: {
    /** Holds the first delivery back by this long. */
    readonly delaySeconds?: number | undefined;
    /** Defaults to the queue's retention. */
    readonly retentionSeconds?: number | undefined;
    /** Stable across retries, so a repeated publish is a no-op. */
    readonly idempotencyKey: string;
  };
};

/** `duplicate`: the idempotency key was already published. */
export type QueuePublishOutcome = "published" | "duplicate";

interface IQueuePublisher {
  readonly publish: (
    publication: QueuePublication
  ) => Effect.Effect<QueuePublishOutcome, QueueMessageSendError>;
}

/** Sends messages to Vercel Queue topics. */
export class QueuePublisher extends Context.Service<
  QueuePublisher,
  IQueuePublisher
>()("@deskohub-workspace/QueuePublisher") {
  /**
   * Publishes through `@vercel/queue`. A duplicate idempotency key means the
   * message is already published, so it succeeds as `duplicate`.
   */
  static Default = Layer.succeed(this, {
    publish: ({ topic, message, options }) =>
      Effect.tryPromise({
        try: () => send(topic, message, options),
        catch: (cause) =>
          cause instanceof DuplicateMessageError
            ? new DuplicateQueueMessageError()
            : new QueueMessageSendError({ topic, cause }),
      }).pipe(
        Effect.as<QueuePublishOutcome>("published"),
        Effect.catchTag("DuplicateQueueMessageError", () =>
          Effect.succeed<QueuePublishOutcome>("duplicate")
        )
      ),
  });
}
