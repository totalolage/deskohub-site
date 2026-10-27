import { Effect, Layer } from "effect";
import {
  QueueMessageSendError,
  type QueuePublication,
  QueuePublisher,
  type QueuePublishOutcome,
} from "./queue-publisher";

/**
 * An in-process queue behind `QueuePublisher`. It records every published
 * message, answers a repeated idempotency key on a topic as `duplicate` as
 * the real queue does, and lets a test deliver, redeliver, drop or duplicate
 * pending messages.
 */
export const makeMemoryQueue = () => {
  const keysByTopic = new Map<string, Set<string>>();
  const published: Array<QueuePublication> = [];
  const pending: Array<QueuePublication> = [];

  const publish = (publication: QueuePublication): QueuePublishOutcome => {
    const keys = keysByTopic.get(publication.topic) ?? new Set<string>();
    keysByTopic.set(publication.topic, keys);
    if (keys.has(publication.options.idempotencyKey)) return "duplicate";
    keys.add(publication.options.idempotencyKey);
    published.push(publication);
    pending.push(publication);
    return "published";
  };

  return {
    layer: Layer.succeed(QueuePublisher, {
      publish: (publication) => Effect.sync(() => publish(publication)),
    }),
    /** Every message ever published, in order. */
    published: (): ReadonlyArray<QueuePublication> => [...published],
    /** Messages not yet taken, in delivery order. */
    pending: (): ReadonlyArray<QueuePublication> => [...pending],
    /** Removes and returns the next pending message. */
    take: () => pending.shift(),
    /** Puts a message back at the end, as a redelivery after a failure. */
    redeliver: (publication: QueuePublication) => {
      pending.push(publication);
    },
    /** Loses every pending message, as an expired or lost publish. */
    dropPending: () => {
      pending.length = 0;
    },
  };
};

/** A queue that rejects every publish, as an unavailable queue would. */
export const unavailableQueue = (cause?: unknown) =>
  Layer.succeed(QueuePublisher, {
    publish: ({ topic }) =>
      Effect.fail(
        new QueueMessageSendError({
          topic,
          cause: cause ?? new Error("queue down"),
        })
      ),
  });
