import { DuplicateMessageError, send } from "@vercel/queue";
import { Data, Effect } from "effect";

export class QueueMessageSendError extends Data.TaggedError(
  "QueueMessageSendError"
)<{
  readonly topic: string;
  readonly cause?: unknown;
}> {}

class DuplicateQueueMessageError extends Data.TaggedError(
  "DuplicateQueueMessageError"
) {}

export type QueueMessageOptions = {
  /** Stable across retries, so a repeated publish is a no-op. */
  readonly idempotencyKey: string;
  /** Defaults to the queue's retention. */
  readonly retentionSeconds?: number;
};

/**
 * Publishes one message to a Vercel queue topic. A duplicate idempotency key
 * means the message is already published, so it succeeds.
 */
export const publishQueueMessage = <Payload>(
  topic: string,
  payload: Payload,
  options: QueueMessageOptions,
  sendMessage: typeof send = send
): Effect.Effect<void, QueueMessageSendError> =>
  Effect.tryPromise({
    try: () => sendMessage(topic, payload, options),
    catch: (cause) =>
      cause instanceof DuplicateMessageError
        ? new DuplicateQueueMessageError()
        : new QueueMessageSendError({
            topic,
            cause,
          }),
  }).pipe(
    Effect.asVoid,
    Effect.catchTag("DuplicateQueueMessageError", () => Effect.void)
  );
